import { test, expect, chromium, type Page } from '@playwright/test';
import type { AppState } from '../lib/domain';
import { audioFixture } from './fixtures';

const baseURL = 'http://127.0.0.1:3100';

async function session(fixture: 'story' | 'answer' | 'long' = 'story') {
  const browser = await chromium.launch({ channel: 'chrome', args: [
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${audioFixture(fixture)}%noloop`,
    '--disable-background-networking',
  ] });
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'oai-authenticated-user-id': `e2e-${crypto.randomUUID()}` }, serviceWorkers: 'block' });
  await context.grantPermissions(['microphone'], { origin: baseURL });
  const external: string[] = [];
  const errors: string[] = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      external.push(`${url.origin}${url.pathname}`); await route.abort();
    } else await route.continue();
  });
  // Disable only cloud-backed browser speech recognition. Recording stays native.
  // This suite proves audio transport; transcript semantics have separate tests.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // Empty new-author GET /api/state is intentionally 404 in this baseline.
    if (['error', 'warning'].includes(message.type()) && !message.text().includes('404 (Not Found)')) errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(async () => (await context.request.get('/api/ai/capabilities')).json()).toMatchObject({ mode: 'deterministic' });
  const voice = await (await context.request.get('/api/voice/capabilities')).json();
  expect(voice.transcription.available).toBe(false);
  expect(voice.narration.available).toBe(false);
  return { browser, context, page, external, errors };
}

async function capture(page: Page) {
  await page.getByRole('button', { name: 'Начать свою книгу', exact: true }).first().click();
  await page.getByRole('button', { name: 'Да, хочу рассказать', exact: true }).click();
  await expect(page.getByLabel('Твоя история', { exact: true })).toBeVisible();
}

async function record(page: Page, seconds = 9) {
  const count = await page.locator('.fragment-card').count();
  await page.getByRole('button', { name: /^(Начать запись|Записать дальше|Записать голосом)$/ }).click();
  await expect(page.getByRole('timer')).toContainText('Идёт запись');
  await expect.poll(async () => {
    const value = (await page.getByRole('timer').textContent())?.match(/(\d+):(\d+)/);
    return value ? Number(value[1]) * 60 + Number(value[2]) : 0;
  }, { timeout: (seconds + 8) * 1000, intervals: [250] }).toBeGreaterThanOrEqual(seconds);
  await page.getByRole('button', { name: 'Остановить запись', exact: true }).click();
  await expect(page.locator('.fragment-card')).toHaveCount(count + 1);
  await expect(page.locator('.fragment-card').last()).toContainText('оригинал сохранён');
}

async function persisted(page: Page): Promise<AppState> {
  await expect.poll(async () => (await page.request.get('/api/state')).status()).toBe(200);
  const response = await page.request.get('/api/state');
  expect(response.ok()).toBe(true);
  return response.json();
}

test('native fake microphone: voice-only capture, saved Blob, playback, reload', async () => {
  const s = await session();
  try {
    await capture(s.page);
    await record(s.page);
    await expect.poll(async () => (await persisted(s.page)).captureDrafts?.[0]?.storyFragments.length).toBe(1);
    const before = (await persisted(s.page)).captureDrafts![0];
    const fragment = before.storyFragments[0].fragment;
    expect(fragment.uploadStatus).toBe('saved');
    expect(fragment.objectKey).toBeTruthy();
    const media = await s.page.request.get(`/api/media?key=${encodeURIComponent(fragment.objectKey!)}`);
    expect(media.ok()).toBe(true);
    expect((await media.body()).length).toBeGreaterThan(1000);
    await s.page.reload();
    const audio = s.page.locator('.fragment-card audio').first();
    await expect(audio).toBeVisible();
    const decoded = await audio.evaluate(async el => {
      const player = el as HTMLAudioElement;
      const bytes = await (await fetch(player.src)).arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(bytes);
      const duration = decoded.duration;
      await ctx.close();
      await player.play();
      player.currentTime = 2;
      return { duration, paused: player.paused, seek: player.currentTime };
    });
    expect(decoded.duration).toBeGreaterThan(8);
    expect(decoded.paused).toBe(false);
    expect(decoded.seek).toBe(2);
    expect((await persisted(s.page)).captureDrafts![0].storyFragments[0].fragment.id).toBe(fragment.id);
    expect(s.external).toEqual([]);
    expect(s.errors).toEqual([]);
  } finally { await s.browser.close(); }
});

test('reload while upload acknowledgement is pending recovers the same server original', async () => {
  const s = await session();
  let release!: () => void;
  const acknowledgement = new Promise<void>(resolve => { release = resolve; });
  let uploaded = false;
  let pendingId = '';
  s.page.on('request', request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/state') {
      const input = request.postDataJSON() as AppState;
      pendingId = input.captureDrafts?.[0]?.storyFragments[0]?.fragment.id ?? pendingId;
    }
  });
  await s.page.route('**/api/media?**', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    uploaded = response.ok();
    await acknowledgement;
    try { await route.fulfill({ response }); } catch { /* Navigation may already have cancelled the acknowledgement. */ }
  });
  try {
    await capture(s.page);
    await s.page.getByRole('button', { name: 'Начать запись', exact: true }).click();
    await expect(s.page.getByRole('timer')).toContainText('00:02');
    await s.page.getByRole('button', { name: 'Остановить запись', exact: true }).click();
    await expect.poll(() => uploaded).toBe(true);
    await expect.poll(() => pendingId).not.toBe('');
    await s.page.reload();
    release();
    await expect(s.page.locator('.fragment-card audio')).toBeVisible();
    const restored = (await persisted(s.page)).captureDrafts![0].storyFragments[0].fragment;
    expect(restored.id).toBe(pendingId);
    expect(restored.uploadStatus).toBe('saved');
    expect(restored.objectKey).toBeTruthy();
    expect(s.external).toEqual([]);
  } finally { release(); await s.browser.close(); }
});

for (const failure of ['NotAllowedError', 'NotFoundError'] as const) {
  test(`microphone ${failure}: honest error, typed draft survives and user can continue`, async () => {
    const s = await session();
    try {
      await capture(s.page);
      await s.page.getByLabel('Твоя история', { exact: true }).fill('Этот синтетический текст должен остаться.');
      // Negative-only device boundary. Positive transport tests never replace it.
      await s.page.evaluate(name => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Synthetic device failure', name));
      }, failure);
      await s.page.getByRole('button', { name: 'Начать запись', exact: true }).click();
      await expect(s.page.getByRole('status')).toContainText('Доступ к микрофону не получен');
      await expect(s.page.locator('.fragment-card')).toHaveCount(0);
      await expect.poll(async () => (await persisted(s.page)).captureDrafts![0].sourceText).toBe('Этот синтетический текст должен остаться.');
      await s.page.reload();
      await expect(s.page.getByLabel('Твоя история', { exact: true })).toHaveValue('Этот синтетический текст должен остаться.');
      await expect(s.page.getByRole('button', { name: 'Собрать историю сейчас', exact: true })).toBeEnabled();
      expect(s.external).toEqual([]); expect(s.errors).toEqual([]);
    } finally { await s.browser.close(); }
  });
}

test('double Record/Stop cannot duplicate a fragment or navigate away during capture', async () => {
  const s = await session();
  try {
    await capture(s.page);
    await s.page.getByLabel('Твоя история', { exact: true }).fill('Материал до записи.');
    await s.page.getByRole('button', { name: 'Начать запись', exact: true }).evaluate(el => {
      (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click();
    });
    await expect(s.page.getByRole('timer')).toBeVisible();
    await expect(s.page.getByRole('button', { name: 'Собрать историю сейчас', exact: true })).toBeDisabled();
    await s.page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(s.page.getByRole('timer')).toBeVisible();
    await expect(s.page.getByLabel('Твоя история', { exact: true })).toBeVisible();
    await s.page.getByRole('button', { name: 'Остановить запись', exact: true }).evaluate(el => {
      (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click();
    });
    await expect(s.page.locator('.fragment-card')).toHaveCount(1);
    await expect.poll(async () => (await persisted(s.page)).captureDrafts![0].storyFragments.length).toBe(1);
    expect(s.external).toEqual([]); expect(s.errors).toEqual([]);
  } finally { await s.browser.close(); }
});

async function addToBook(page: Page) {
  await page.getByRole('button', { name: 'Собрать историю сейчас', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Предложение AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Применить новой версией', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Предложение AI' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Всё верно — добавить в книгу', exact: true }).click();
  if (await page.getByRole('heading', { name: 'Сохрани первую историю', exact: true }).count()) {
    await page.getByLabel('Как к тебе обращаться').fill('Синтетический автор');
    await page.getByLabel('Электронная почта').fill('synthetic@example.test');
    await page.getByRole('button', { name: 'Сохранить и открыть книгу', exact: true }).click();
  }
  await expect(page.locator('.reader-page')).toBeVisible();
}

test('mixed text and multiple native fragments preserve order and drafts', async () => {
  const s = await session();
  try {
    await capture(s.page);
    await s.page.getByLabel('Твоя история', { exact: true }).fill('Синтетическая история. В мастерской я сложил бумагу.');
    await record(s.page, 3);
    await s.page.getByLabel('Расшифровка 1', { exact: true }).fill('Первый голосовой фрагмент: получился бумажный дом.');
    await s.page.getByLabel('Твоя история', { exact: true }).fill('Синтетическая история. В мастерской я сложил бумагу. Затем добавил окно.');
    await record(s.page, 3);
    await s.page.getByLabel('Расшифровка 2', { exact: true }).fill('Второй голосовой фрагмент: я поставил дом на стол.');
    await expect.poll(async () => (await persisted(s.page)).captureDrafts![0].storyFragments.map(f => f.transcript)).toEqual([
      'Первый голосовой фрагмент: получился бумажный дом.', 'Второй голосовой фрагмент: я поставил дом на стол.',
    ]);
    const before = (await persisted(s.page)).captureDrafts![0];
    expect(before.storyFragments.map(f => f.fragment.position)).toEqual([1, 2]);
    await s.page.reload();
    await expect(s.page.getByLabel('Твоя история', { exact: true })).toHaveValue(before.sourceText);
    await expect(s.page.locator('.fragment-card audio')).toHaveCount(2);
    await addToBook(s.page);
    const story = (await persisted(s.page)).stories[0];
    expect(story.audioFragments!.map(f => f.id)).toEqual(before.storyFragments.map(f => f.fragment.id));
    expect(story.text).toContain('Затем добавил окно.');
    expect(story.text).toContain('Первый голосовой фрагмент');
    expect(story.text).toContain('Второй голосовой фрагмент');
    expect(story.sources.filter(source => source.audioFragmentId)).toHaveLength(2);
    expect(s.external).toEqual([]); expect(s.errors).toEqual([]);
  } finally { await s.browser.close(); }
});

test('question voice answer, manual transcript revision, reversible audio archive and book reload', async () => {
  const s = await session('answer');
  try {
    await capture(s.page);
    await s.page.getByLabel('Твоя история', { exact: true }).fill('В субботу я сделал бумажный макет.');
    await s.page.getByRole('button', { name: 'Уточняющие вопросы', exact: true }).click();
    await expect(s.page.locator('.ai-purpose')).toBeVisible();
    const question = (await persisted(s.page)).captureDrafts![0].interviewQuestions!.at(-1)!;
    await record(s.page, 5);
    await s.page.getByLabel('Расшифровка 1', { exact: true }).fill('Я хотел проверить, получится ли сложить макет самостоятельно.');
    await s.page.getByRole('button', { name: 'Сохранить голосовой ответ', exact: true }).click();
    await expect.poll(async () => (await persisted(s.page)).captureDrafts![0].interviewAnswers.length).toBe(1);
    expect((await persisted(s.page)).captureDrafts![0].answerFragments).toEqual([]);
    await addToBook(s.page);
    const initial = (await persisted(s.page)).stories[0];
    const answer = initial.interviewAnswers[0];
    expect(answer.questionId).toBe(question.id);
    expect(answer.audioFragmentId).toBeTruthy();
    expect(initial.sources.some(source => source.questionId === question.id && source.audioFragmentId === answer.audioFragmentId)).toBe(true);
    expect(initial.transcriptRevisions!.some(revision => revision.audioFragmentId === answer.audioFragmentId)).toBe(true);
    await s.page.getByText('Исходные материалы', { exact: false }).first().click();
    await s.page.getByRole('button', { name: 'Исправить текст вручную', exact: true }).first().click();
    await s.page.getByLabel('Новая проверенная версия текста').fill('Я хотел проверить свою идею самостоятельно.');
    await s.page.getByRole('button', { name: 'Сохранить ручную версию', exact: true }).click();
    await expect.poll(async () => (await persisted(s.page)).stories[0].text).toContain('Я хотел проверить свою идею самостоятельно.');
    const corrected = (await persisted(s.page)).stories[0];
    expect(corrected.transcriptRevisions!.length).toBeGreaterThan(initial.transcriptRevisions!.length);
    expect(corrected.revisions.length).toBeGreaterThan(initial.revisions.length);
    expect(corrected.audioFragments).toEqual(initial.audioFragments);
    await s.page.getByRole('button', { name: 'Убрать аудио из отображения', exact: true }).click();
    await expect(s.page.getByRole('button', { name: 'Вернуть аудио в отображение', exact: true })).toBeVisible();
    await s.page.getByRole('button', { name: 'Вернуть аудио в отображение', exact: true }).click();
    await s.page.reload();
    const reloaded = (await persisted(s.page)).stories[0];
    expect(reloaded.audioFragments![0].objectKey).toBe(initial.audioFragments![0].objectKey);
    for (const revision of initial.transcriptRevisions!) {
      const preserved = reloaded.transcriptRevisions!.find(item => item.id === revision.id)!;
      expect({ ...preserved, selected: revision.selected }).toEqual(revision);
    }
    expect(s.external).toEqual([]); expect(s.errors).toEqual([]);
  } finally { await s.browser.close(); }
});

test('book-state voice addition, draft reload and newest-first story order', async () => {
  const s = await session();
  try {
    await capture(s.page);
    await s.page.getByLabel('Твоя история', { exact: true }).fill('Первый синтетический рассказ о бумажном кораблике.');
    await addToBook(s.page);
    const original = (await persisted(s.page)).stories[0];
    await s.page.getByRole('button', { name: /Добавить текст или голос/ }).click();
    await s.page.getByLabel('Новый текст для истории').fill('Дополнение к первому рассказу.');
    await record(s.page, 3);
    await s.page.locator('.book-addition-editor .fragment-card textarea').fill('Голосовое дополнение: кораблик остался на полке.');
    await expect.poll(async () => (await persisted(s.page)).storyEditDrafts?.[0]?.fragments[0]?.transcript).toContain('кораблик остался');
    await s.page.reload();
    await s.page.locator('.story-card').first().click();
    await s.page.getByRole('button', { name: /Добавить текст или голос/ }).click();
    await expect(s.page.locator('.book-addition-editor audio')).toHaveCount(1);
    await s.page.getByRole('button', { name: 'Сохранить дополнение', exact: true }).click();
    await expect.poll(async () => (await persisted(s.page)).stories[0].text).toContain('кораблик остался на полке');
    const extended = (await persisted(s.page)).stories[0];
    for (const source of original.sources) expect(extended.sources).toContainEqual(source);
    expect(extended.audioFragments).toHaveLength(1);
    await s.page.getByRole('button', { name: '← Ко всем историям', exact: true }).click();
    await s.page.getByRole('button', { name: 'Продолжить книгу', exact: true }).click();
    await s.page.getByRole('button', { name: 'Да, хочу рассказать', exact: true }).click();
    await s.page.getByLabel('Твоя история', { exact: true }).fill('Второй синтетический рассказ о новом макете.');
    await addToBook(s.page);
    await s.page.getByRole('button', { name: '← Ко всем историям', exact: true }).click();
    await expect(s.page.locator('.story-card h2').first()).toContainText('Второй синтетический рассказ');
    await s.page.reload();
    expect((await persisted(s.page)).stories).toHaveLength(2);
    expect(s.external).toEqual([]); expect(s.errors).toEqual([]);
  } finally { await s.browser.close(); }
});

test('long native recording >100s retains start, middle and end markers after reload', async () => {
  const s = await session('long');
  try {
    await capture(s.page);
    await record(s.page, 105);
    await expect.poll(async () => (await persisted(s.page)).captureDrafts?.[0]?.storyFragments.length).toBe(1);
    const fragment = (await persisted(s.page)).captureDrafts![0].storyFragments[0].fragment;
    expect(fragment.durationMs).toBeGreaterThan(100_000);
    await s.page.reload();
    await expect(s.page.locator('.fragment-card audio')).toBeVisible();
    const markers = await s.page.locator('.fragment-card audio').evaluate(async el => {
      const bytes = await (await fetch((el as HTMLAudioElement).src)).arrayBuffer();
      const ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(bytes);
      const samples = buffer.getChannelData(0);
      const frequencies = [4, 50, 102].map(second => {
        const start = Math.floor((second + 0.2) * buffer.sampleRate);
        const end = start + Math.floor(buffer.sampleRate * 0.5);
        let crossings = 0;
        let power = 0;
        for (let i = start + 1; i < end; i++) {
          if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
          power += samples[i] ** 2;
        }
        return { hz: crossings / 0.5, rms: Math.sqrt(power / (end - start)) };
      });
      await ctx.close();
      return { duration: buffer.duration, frequencies };
    });
    expect(markers.duration).toBeGreaterThan(104);
    for (const [i, frequency] of [440, 660, 880].entries()) {
      expect(markers.frequencies[i].hz).toBeGreaterThan(frequency - 20);
      expect(markers.frequencies[i].hz).toBeLessThan(frequency + 20);
      expect(markers.frequencies[i].rms).toBeGreaterThan(0.005);
    }
    await test.info().attach('long-recording-proof', { body: JSON.stringify({ fragment, markers }), contentType: 'application/json' });
    expect(s.external).toEqual([]); expect(s.errors).toEqual([]);
  } finally { await s.browser.close(); }
});
