import { NextRequest, NextResponse } from 'next/server';
import { authenticatedUserId } from './server-auth';
import { loadAuthorState, saveAuthorState, StateConflictError } from './server-state';
import { YandexSpeechKitTTSProvider } from './speechkit-provider';
import { readSpeechKitTrialConfig } from './voice-trial-config';
import { estimateTtsRub, markTrialOperation, reserveTrialOperation } from './voice-trial-budget';
import { completeNarration, failNarration, markNarrationProcessing, queueNarration } from './voice-logic';
import { qaTrialStoryEligibility } from './voice-trial-policy';

const PROVIDER_ID = 'yandex-speechkit-v3';
export const SPEECHKIT_TRIAL_VOICES = ['marina', 'jane', 'dasha', 'julia', 'alexander', 'kirill'] as const;

function extensionFor(contentType: string) {
  if (contentType === 'audio/mpeg') return 'mp3';
  if (contentType === 'audio/ogg' || contentType === 'audio/opus') return 'ogg';
  if (contentType === 'audio/wav' || contentType === 'audio/x-wav') return 'wav';
  throw new Error('Unsupported narration format.');
}

export async function handleSpeechKitNarration(request: NextRequest, runtimeEnv: Cloudflare.Env) {
  const userId = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!userId) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const config = readSpeechKitTrialConfig(runtimeEnv);
  if (!config) return NextResponse.json({ error: 'provider_not_configured', message: 'SpeechKit trial заблокирован до проверки тарифа billing account и защищённой установки ограниченного ключа.' }, { status: 503 });
  const body = await request.json() as { storyId?: string; voiceId?: string };
  if (!body.storyId || !body.voiceId || !SPEECHKIT_TRIAL_VOICES.includes(body.voiceId as typeof SPEECHKIT_TRIAL_VOICES[number])) return NextResponse.json({ error: 'storyId and approved trial voiceId are required' }, { status: 400 });
  try {
    let state = await loadAuthorState(runtimeEnv.DB, userId);
    if (!state) return NextResponse.json({ error: 'book_not_found' }, { status: 404 });
    let story = state.stories.find((item) => item.id === body.storyId);
    if (!story) return NextResponse.json({ error: 'story_not_found' }, { status: 404 });
    if (!qaTrialStoryEligibility(story.externalProcessingPolicy)) return NextResponse.json({ error: 'qa_only', message: 'SpeechKit trial не принимает существующие реальные истории. Ничего не отправлено.' }, { status: 403 });
    const revision = story.revisions.at(-1);
    if (!revision || !revision.text.trim()) return NextResponse.json({ error: 'story_revision_required' }, { status: 409 });
    let narration = [...(story.narrations ?? [])].reverse().find((item) => item.provider === PROVIDER_ID && item.storyRevisionId === revision.id && item.voiceId === body.voiceId && item.status !== 'failed');
    if (narration?.status === 'ready') return NextResponse.json(state);
    if (!narration) {
      story = queueNarration(story, PROVIDER_ID, body.voiceId);
      narration = [...(story.narrations ?? [])].reverse().find((item) => item.provider === PROVIDER_ID && item.storyRevisionId === revision.id && item.voiceId === body.voiceId)!;
      story = { ...story, narrations: story.narrations?.map((item) => item.id === narration!.id ? { ...item, billingOperationId: narration!.id } : item) };
      state = await saveAuthorState(runtimeEnv.DB, userId, { ...state, stories: state.stories.map((item) => item.id === story!.id ? story! : item), updatedAt: story.updatedAt });
      story = state.stories.find((item) => item.id === story!.id)!;
      const savedNarration = story.narrations?.find((item) => item.id === narration!.id);
      if (!savedNarration) throw new Error('Narration disappeared after save.');
      narration = savedNarration;
    }
    const operationId = narration.billingOperationId ?? narration.id;
    const reservation = await reserveTrialOperation({ db: runtimeEnv.DB, operationId, userId, kind: 'tts', sourceId: revision.id, qaNonpersonalVerified: true, maxCostRub: estimateTtsRub(revision.text, config.ttsRubPer250Chars), capRub: config.capRub });
    if (!reservation.claimed) {
      const message = reservation.operation ? 'Эта платная генерация уже была зарезервирована и не повторяется автоматически.' : `Лимит SpeechKit trial исчерпан (${reservation.reservedTotalRub.toFixed(4)} ₽ зарезервировано).`;
      story = failNarration(story, narration.id, { code: 'trial_reservation_blocked', message });
    } else {
      const provider = new YandexSpeechKitTTSProvider(config.apiKey, { db: runtimeEnv.DB, userId, operationId, sourceId: revision.id });
      story = markNarrationProcessing(story, narration.id);
      try {
        const result = await provider.submit({ text: revision.text, language: 'ru-RU', voiceId: body.voiceId });
        if (result.status !== 'ready') throw new Error('Unexpected asynchronous TTS result.');
        const key = `${userId}/${story.id}/narrations/${narration.id}.${extensionFor(result.value.contentType)}`;
        await runtimeEnv.STORY_MEDIA.put(key, result.value.audio, { httpMetadata: { contentType: result.value.contentType } });
        story = completeNarration(story, narration.id, { objectKey: key, contentType: result.value.contentType, durationMs: result.value.durationMs, voiceId: result.value.voiceId });
        state = await saveAuthorState(runtimeEnv.DB, userId, { ...state, stories: state.stories.map((item) => item.id === story!.id ? story! : item), updatedAt: story.updatedAt });
        await markTrialOperation({ db: runtimeEnv.DB, operationId, status: 'completed' });
        return NextResponse.json(state);
      } catch (error) {
        await markTrialOperation({ db: runtimeEnv.DB, operationId, status: 'uncertain' });
        throw error;
      }
    }
    return NextResponse.json(await saveAuthorState(runtimeEnv.DB, userId, { ...state, stories: state.stories.map((item) => item.id === story!.id ? story! : item), updatedAt: story.updatedAt }));
  } catch (error) {
    if (error instanceof StateConflictError) return NextResponse.json({ error: 'conflict', message: 'История изменилась в другой вкладке. Платный вызов не повторён.' }, { status: 409 });
    return NextResponse.json({ error: 'voice_operation_failed', message: 'Озвучка не завершилась. Текст и прежние narration assets сохранены; платный вызов не повторяется автоматически.' }, { status: 502 });
  }
}
