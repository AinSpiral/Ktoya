import { chromium, expect, test, type Page } from '@playwright/test';
import { audioFixture } from './fixtures';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = 'http://127.0.0.1:3100';

async function login(page: Page, code = 'e2e-friend-access') {
  await page.goto('/');
  await page.getByLabel('Код доступа').fill(code);
  await page.getByRole('button', { name: 'Войти в Friends Beta' }).click();
  await expect(page.getByRole('button', { name: 'Оставить отзыв' })).toBeVisible();
}

async function friendContext(options: { fakeMic?: boolean } = {}) {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: options.fakeMic ? [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFixture('story')}%noloop`,
      '--disable-background-networking',
    ] : ['--disable-background-networking'],
  });
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });
  if (options.fakeMic) await context.grantPermissions(['microphone'], { origin: baseURL });
  return { browser, context, page: await context.newPage() };
}

async function ownerContext() {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-background-networking'] });
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/feedback-inbox');
  await page.getByLabel('Owner-код').fill('e2e-owner-access');
  await page.getByRole('button', { name: 'Открыть inbox' }).click();
  await expect(page.getByRole('heading', { name: 'Отзывы тестировщиков' })).toBeVisible();
  return { browser, context, page };
}

async function browserCsrf(page: Page) {
  return page.evaluate(() => {
    const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('ktoya_fb_csrf='));
    return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : '';
  });
}

test('voice feedback: fake mic, re-record, 10-second upload, reload, owner playback and status', async () => {
  const tester = await friendContext({ fakeMic: true });
  let owner: Awaited<ReturnType<typeof ownerContext>> | null = null;
  try {
    await login(tester.page);
    await tester.page.getByRole('button', { name: 'Оставить отзыв' }).click();
    const dialog = tester.page.getByRole('dialog', { name: 'Оставить отзыв' });
    await mkdir(resolve('outputs/living-world-v2/after'), { recursive: true });
    await tester.page.screenshot({path:resolve('outputs/living-world-v2/after/feedback-dialog-390.png'),animations:'disabled'});
    await dialog.getByRole('button', { name: 'Записать голосом' }).click();
    await expect(dialog.locator('.recording-indicator')).toContainText('00:02');
    await tester.page.screenshot({path:resolve('outputs/living-world-v2/after/feedback-recording-390.png'),animations:'disabled'});
    await dialog.getByRole('button', { name: 'Остановить' }).click();
    await expect(dialog.getByRole('button', { name: 'Перезаписать' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Перезаписать' }).click();
    await dialog.getByRole('button', { name: 'Записать голосом' }).click();
    await expect(dialog.locator('.recording-indicator')).toContainText('00:10', { timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Остановить' }).click();
    await expect(dialog.locator('audio')).toBeVisible();
    await dialog.getByLabel(/Имя или псевдоним/).fill('Tester A');
    await dialog.getByLabel(/Текст — необязательно/).fill('Голосовой отзыв для проверки приватного inbox.');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Отправить отзыв' }).click();
    await expect(dialog.getByRole('status')).toContainText('Спасибо! Отзыв сохранён');
    await tester.page.reload();
    await expect(tester.page.getByRole('button', { name: 'Оставить отзыв' })).toBeVisible();

    const testerAdmin = await tester.page.request.get('/api/feedback/admin');
    expect(testerAdmin.status()).toBe(403);

    owner = await ownerContext();
    const item = owner.page.locator('.feedback-item').filter({ hasText: 'Tester A' }).first();
    await expect(item).toContainText('Голосовой отзыв для проверки приватного inbox.');
    await expect(item.getByText('Черновая авторасшифровка')).toHaveCount(0);
    const audio = item.locator('audio');
    await expect(audio).toBeVisible();
    const playback = await owner.page.evaluate(async (src) => {
      const response = await fetch(src);
      return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    }, await audio.getAttribute('src') ?? '');
    expect([200, 206]).toContain(playback.status);
    expect(playback.bytes).toBeGreaterThan(1_000);
    await item.getByLabel('Статус').selectOption('READ');
    await owner.page.reload();
    await expect(owner.page.locator('.feedback-item').filter({ hasText: 'Tester A' }).first().getByLabel('Статус')).toHaveValue('READ');
    const ownerState = await owner.page.evaluate(async () => (await fetch('/api/friends/state')).status);
    expect(ownerState).toBe(401);
  } finally {
    await owner?.browser.close();
    await tester.browser.close();
  }
});

test('text fallback, idempotence, CSRF, and Tester A / Tester B isolation', async () => {
  const a = await friendContext();
  const b = await friendContext();
  let owner: Awaited<ReturnType<typeof ownerContext>> | null = null;
  try {
    await login(a.page);
    const fallbackMarker = `Текст без микрофона ${crypto.randomUUID()}`;
    await a.page.getByRole('button', { name: 'Оставить отзыв' }).click();
    await a.page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    const dialog = a.page.getByRole('dialog', { name: 'Оставить отзыв' });
    await dialog.getByRole('button', { name: 'Записать голосом' }).click();
    await expect(dialog.getByRole('status')).toContainText('Текстовый отзыв остаётся доступен');
    await dialog.getByLabel(/Текст — необязательно/).fill(fallbackMarker);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Отправить отзыв' }).click();
    await expect(dialog.getByRole('status')).toContainText('Спасибо!');

    const csrf = await browserCsrf(a.page);
    const id = crypto.randomUUID();
    const idempotenceMarker = `Идемпотентный отзыв ${id}`;
    const submit = (withCsrf: boolean) => a.page.evaluate(async ({ id, csrf, withCsrf }) => {
      const form = new FormData();
      form.set('id', id);
      form.set('category', 'idea');
      form.set('text', `Идемпотентный отзыв ${id}`);
      form.set('consent', 'true');
      form.set('route', '/#landing');
      form.set('viewportWidth', String(innerWidth));
      form.set('viewportHeight', String(innerHeight));
      const response = await fetch('/api/feedback', { method: 'POST', headers: withCsrf ? { 'x-ktoya-csrf': csrf } : {}, body: form });
      return { status: response.status, body: await response.json() as { duplicate?: boolean } };
    }, { id, csrf, withCsrf });
    expect((await submit(false)).status).toBe(403);
    expect((await submit(true)).status).toBe(201);
    const duplicate = await submit(true);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);

    await a.page.getByRole('button', { name: 'Рассказать первую историю', exact: true }).first().click();
    await a.page.getByRole('button', { name: 'Да, хочу рассказать', exact: true }).click();
    await a.page.getByLabel('Твоя история', { exact: true }).fill('Отдельная история Tester A.');
    await expect.poll(async () => a.page.evaluate(async () => (await fetch('/api/friends/state')).status)).toBe(200);

    await login(b.page);
    await expect(b.page.getByText('Отдельная история Tester A.')).toHaveCount(0);
    const bState = await b.page.evaluate(async () => (await fetch('/api/friends/state')).status);
    expect(bState).toBe(404);

    owner = await ownerContext();
    await expect(owner.page.getByText(idempotenceMarker, { exact: true })).toHaveCount(1);
    await expect(owner.page.getByText(fallbackMarker, { exact: true })).toHaveCount(1);
  } finally {
    await owner?.browser.close();
    await a.browser.close();
    await b.browser.close();
  }
});
