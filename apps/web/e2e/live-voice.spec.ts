import { chromium, expect, test, type Page, type Route } from '@playwright/test';
import { audioFixture } from './fixtures';
import type { AppState, CaptureDraftFragment, InterviewQuestion } from '../lib/domain';

const baseURL = 'http://127.0.0.1:3100';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Код доступа').fill('e2e-friend-c-access');
  await page.getByRole('button', { name: 'Войти в Friends Beta' }).click();
  await expect(page.getByRole('button', { name: 'Рассказать первую историю', exact: true }).first()).toBeVisible();
}

test('fake mic live voice: explicit consent, one request, improved transcript, text and audio answer', async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: [
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${audioFixture('story')}%noloop`,
    '--disable-background-networking',
  ] });
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.grantPermissions(['microphone'], { origin: baseURL });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  let calls = 0;
  await page.route('**/api/friends/voice/capabilities', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      transcription: { available: true, retrySavedAudio: false, message: 'Realtime TEST mock готов.' },
      narration: { available: false, reusableAudio: false, message: 'Озвучка выключена.' },
      trialQaOnly: false,
      externalConsentRequired: true,
    }),
  }));
  await page.route('**/api/friends/live/voice-turn', async (route: Route) => {
    calls += 1;
    const body = route.request().postDataJSON() as { captureDraftId: string; audioFragmentId: string };
    const state = await page.evaluate(async () => {
      const response = await fetch('/api/friends/state', { cache: 'no-store' });
      if (!response.ok) throw new Error(`state unavailable: ${response.status}`);
      return response.json();
    }) as AppState;
    const draft = state.captureDrafts?.find((item) => item.id === body.captureDraftId);
    if (!draft) return route.abort();
    const now = new Date().toISOString();
    const update = (item: CaptureDraftFragment): CaptureDraftFragment => item.fragment.id !== body.audioFragmentId ? item : {
      ...item,
      transcript: 'Я посадил яблоню рядом с домом.',
      transcriptionAttempts: [{
        id: crypto.randomUUID(), audioFragmentId: item.fragment.id, provider: 'yandex-ai-studio-realtime', status: 'ready',
        createdAt: now, updatedAt: now, completedAt: now,
      }],
    };
    const question: InterviewQuestion = {
      id: crypto.randomUUID(), text: 'Кто был рядом с вами в тот день?', category: 'gap', purpose: 'Уточнить важного участника.',
      relatedSourceIds: [body.audioFragmentId], createdAt: now, operationId: crypto.randomUUID(), provider: 'yandex-ai-studio-realtime', model: 'speech-realtime-260528',
    };
    const savedDraft = {
      ...draft,
      storyFragments: draft.storyFragments.map(update),
      answerFragments: draft.answerFragments.map(update),
      interviewQuestions: [...(draft.interviewQuestions ?? []), question],
      updatedAt: now,
    };
    const next = { ...state, captureDrafts: state.captureDrafts?.map((item) => item.id === draft.id ? savedDraft : item), updatedAt: now };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      state: next,
      provider: 'yandex-ai-studio-realtime', model: 'speech-realtime-260528', transcript: 'Я посадил яблоню рядом с домом.',
      assistantText: question.text,
      assistantAudioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=', assistantAudioContentType: 'audio/wav',
      decision: { decision: 'ASK', questionId: question.id, question: question.text, purpose: question.purpose },
      actualCostRub: 0.1234, budget: { capRub: 100, committedRub: 0.1234, remainingRub: 99.8766 },
    }) });
  });
  try {
    await login(page);
    await page.getByRole('button', { name: 'Рассказать первую историю', exact: true }).first().click();
    await page.getByRole('button', { name: 'Да, хочу рассказать', exact: true }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Начать запись', exact: true }).click();
    await expect(page.getByRole('timer')).toContainText('00:03');
    await page.getByRole('button', { name: 'Остановить запись', exact: true }).click();
    await expect(page.locator('.fragment-card')).toContainText('оригинал сохранён');
    await page.getByRole('button', { name: 'Отправить ИИ и получить вопрос' }).click();
    await expect(page.getByRole('heading', { name: 'Кто был рядом с вами в тот день?' })).toBeVisible();
    await expect(page.getByLabel('Расшифровка 1')).toHaveValue('Я посадил яблоню рядом с домом.');
    await expect(page.getByLabel('Прослушать короткий ответ ИИ')).toBeVisible();
    await expect(page.getByText(/Стоимость этого вызова: 0\.1234 ₽; общий остаток: 99\.88 ₽/)).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    await browser.close();
  }
});
