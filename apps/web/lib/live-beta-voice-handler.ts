import { NextRequest, NextResponse } from 'next/server';
import type { AppState, CaptureDraft, CaptureDraftFragment, InterviewQuestion } from './domain';
import { completeLiveBetaOperation, estimateVoiceTurnMaxRub, failLiveBetaOperation, findLiveBetaOperation, liveBetaBudgetStatus, liveBetaCostRub, noteLiveBetaProviderCall, reserveLiveBetaOperation } from './live-beta-budget';
import { LIVE_BETA_CONSENT_VERSION, readLiveBetaConfig } from './live-beta-config';
import { identityStorageOwner, requestIdentity, type RequestIdentity } from './server-auth';
import { loadAuthorState, saveAuthorState, StateConflictError } from './server-state';
import { completeCaptureDraftTranscription, failCaptureDraftTranscription, queueCaptureDraftTranscription } from './voice-logic';
import { hasFinalRealtimeBilling, pcm16WavBase64, pcmFromMono16BitWav, runRealtimeVoiceTurn, YandexRealtimeError } from './yandex-realtime-provider';
import { FeedbackSubmissionError, reserveClassBOperation } from './feedback-store';
import { FRIENDS_BETA_LIMITS } from './friends-limits';

const PROVIDER_ID = 'yandex-ai-studio-realtime';

function replaceDraftFragment(draft: CaptureDraft, fragmentId: string, next: CaptureDraftFragment) {
  const replace = (item: CaptureDraftFragment) => item.fragment.id === fragmentId ? next : item;
  return { ...draft, storyFragments: draft.storyFragments.map(replace), answerFragments: draft.answerFragments.map(replace), voiceAnswerDrafts: draft.voiceAnswerDrafts.map((answer) => ({ ...answer, fragments: answer.fragments.map(replace) })), updatedAt: new Date().toISOString() };
}

function allDraftFragments(draft: CaptureDraft) {
  return [...draft.storyFragments, ...draft.answerFragments, ...draft.voiceAnswerDrafts.flatMap((answer) => answer.fragments)];
}

function mediaPrefix(identity: RequestIdentity) {
  const owner = identityStorageOwner(identity);
  return `friends/${owner.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)}/stories/`;
}

function safeQuestion(text: string, sourceId: string, operationId: string): InterviewQuestion | null {
  const normalized = text.trim().replace(/^[-–—\s]+/, '').slice(0, 600);
  if (!normalized || !/[?？]\s*$/.test(normalized)) return null;
  return {
    id: crypto.randomUUID(),
    text: normalized,
    category: 'gap',
    purpose: 'Помогает раскрыть один важный пробел в текущей истории.',
    relatedSourceIds: [sourceId],
    createdAt: new Date().toISOString(),
    operationId,
    provider: PROVIDER_ID,
    model: 'speech-realtime-260528',
  };
}

async function saveDraft(db: D1Database, userId: string, state: AppState, draft: CaptureDraft) {
  return saveAuthorState(db, userId, { ...state, captureDrafts: state.captureDrafts?.map((item) => item.id === draft.id ? draft : item), updatedAt: draft.updatedAt });
}

export async function handleLiveBetaVoiceTurn(request: NextRequest, runtimeEnv: Cloudflare.Env) {
  const local = ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);
  const identity = await requestIdentity(request, runtimeEnv, local);
  if (!identity || identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 401 });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  const config = readLiveBetaConfig(runtimeEnv);
  if (!config) return NextResponse.json({ error: 'live_beta_not_configured', message: 'Живой ИИ временно выключен: защищённая конфигурация не прошла проверку.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { operationId?: string; captureDraftId?: string; audioFragmentId?: string; consentVersion?: string } | null;
  if (!body || !/^[0-9a-f-]{36}$/i.test(body.operationId ?? '') || !body.captureDraftId || !body.audioFragmentId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (body.consentVersion !== LIVE_BETA_CONSENT_VERSION) return NextResponse.json({ error: 'consent_required', message: 'Перед отправкой нужно подтвердить внешнюю обработку голоса и текста.' }, { status: 403 });

  let state = await loadAuthorState(runtimeEnv.FRIENDS_DB, identity.userId);
  if (!state) return NextResponse.json({ error: 'book_not_found' }, { status: 404 });
  let draft = state.captureDrafts?.find((item) => item.id === body.captureDraftId);
  if (!draft) return NextResponse.json({ error: 'capture_draft_not_found' }, { status: 404 });
  let fragment = allDraftFragments(draft).find((item) => item.fragment.id === body.audioFragmentId);
  if (!fragment) return NextResponse.json({ error: 'audio_fragment_not_found' }, { status: 404 });
  if (draft.externalProcessingPolicy !== 'user-content-approved' || fragment.fragment.externalProcessingPolicy !== 'user-content-approved') return NextResponse.json({ error: 'consent_required', message: 'Эта запись не была помечена как разрешённая для внешней обработки.' }, { status: 403 });
  const derived = [...(fragment.fragment.derivedAssets ?? [])].reverse().find((asset) => asset.purpose === 'stt-input' && asset.contentType === 'audio/wav');
  if (!derived || derived.sourceAudioFragmentId !== fragment.fragment.id || !derived.objectKey.startsWith(mediaPrefix(identity))) return NextResponse.json({ error: 'derived_audio_required' }, { status: 409 });
  let providerCalled = false;
  try {
    const existing = await findLiveBetaOperation(runtimeEnv.FRIENDS_DB, body.operationId!);
    if (existing) return NextResponse.json({ error: 'operation_already_exists', message: 'Этот платный вызов уже учтён и автоматически не повторяется.' }, { status: 409 });
    await reserveClassBOperation(runtimeEnv.FRIENDS_DB);
    const object = await runtimeEnv.FRIENDS_AUDIO.get(derived.objectKey);
    if (!object) throw new Error('derived_audio_missing');
    if (object.size > FRIENDS_BETA_LIMITS.singleAudioBytes) return NextResponse.json({ error: 'audio_too_large' }, { status: 413 });
    const wav = await object.arrayBuffer();
    const pcm = pcmFromMono16BitWav(wav);
    const durationMs = Math.ceil(pcm.byteLength / (16_000 * 2) * 1000);
    if (durationMs > FRIENDS_BETA_LIMITS.singleAudioDurationMs) return NextResponse.json({ error: 'audio_too_long', message: 'Один голосовой ход Closed Beta не может быть длиннее 3 минут.' }, { status: 413 });
    const reservation = await reserveLiveBetaOperation({
      db: runtimeEnv.FRIENDS_DB,
      operationId: body.operationId!,
      userId: identity.userId,
      kind: 'voice-turn',
      model: config.model,
      sourceId: derived.id,
      consentVersion: LIVE_BETA_CONSENT_VERSION,
      maxCostRub: estimateVoiceTurnMaxRub(durationMs, config),
    });
    if (!reservation.claimed) {
      if (reservation.blockedByUnresolved) return NextResponse.json({ error: 'live_beta_retry_blocked', message: 'Предыдущий вызов для этой записи ещё не подтверждён. Повтор заблокирован; оригинал доступен без ИИ.' }, { status: 409 });
      return NextResponse.json({ error: 'live_beta_budget_exhausted', message: `Лимит 100 ₽ не позволяет начать этот вызов. Остаток: ${reservation.budget.remainingRub.toFixed(2)} ₽.` }, { status: 402 });
    }

    fragment = queueCaptureDraftTranscription(fragment, PROVIDER_ID);
    const attempt = [...(fragment.transcriptionAttempts ?? [])].reverse().find((item) => item.provider === PROVIDER_ID && item.status === 'queued');
    if (!attempt) throw new Error('transcription_attempt_not_created');
    const draftId = draft.id;
    draft = replaceDraftFragment(draft, fragment.fragment.id, fragment);
    state = await saveDraft(runtimeEnv.FRIENDS_DB, identity.userId, state, draft);
    const savedDraft = state.captureDrafts?.find((item) => item.id === draftId);
    if (!savedDraft) throw new Error('capture_draft_lost');
    draft = savedDraft;
    const savedFragment = allDraftFragments(draft).find((item) => item.fragment.id === body.audioFragmentId);
    if (!savedFragment) throw new Error('audio_fragment_lost');
    fragment = savedFragment;

    await noteLiveBetaProviderCall(runtimeEnv.FRIENDS_DB, body.operationId!);
    providerCalled = true;
    const result = await runRealtimeVoiceTurn(config, wav, durationMs);
    const cost = liveBetaCostRub(result.usage, config);
    const currentAttempt = [...(fragment.transcriptionAttempts ?? [])].reverse().find((item) => item.provider === PROVIDER_ID && item.status === 'queued');
    if (!currentAttempt) throw new Error('transcription_attempt_lost');
    fragment = completeCaptureDraftTranscription(fragment, currentAttempt.id, result.transcript ?? '');
    draft = replaceDraftFragment(draft, fragment.fragment.id, fragment);
    const question = safeQuestion(result.text, fragment.fragment.id, body.operationId!);
    if (question) draft = { ...draft, interviewQuestions: [...(draft.interviewQuestions ?? []), question], updatedAt: question.createdAt };
    state = await saveDraft(runtimeEnv.FRIENDS_DB, identity.userId, state, draft);
    await completeLiveBetaOperation({ db: runtimeEnv.FRIENDS_DB, operationId: body.operationId!, actualCostRub: cost, usage: result.usage, providerSessionId: result.providerSessionId });
    return NextResponse.json({
      state,
      provider: PROVIDER_ID,
      model: config.model,
      transcript: result.transcript,
      assistantText: result.text,
      assistantAudioBase64: result.audioPcm?.length ? pcm16WavBase64(result.audioPcm) : undefined,
      assistantAudioContentType: result.audioPcm?.length ? 'audio/wav' : undefined,
      decision: question ? { decision: 'ASK', questionId: question.id, question: question.text, purpose: question.purpose } : { decision: 'READY', reason: result.text || 'Запись распознана.' },
      actualCostRub: cost,
      budget: await liveBetaBudgetStatus(runtimeEnv.FRIENDS_DB),
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const known = error instanceof YandexRealtimeError;
    const billingFinal = known && hasFinalRealtimeBilling(error);
    const usage = billingFinal ? error.usage : undefined;
    const cost = usage ? liveBetaCostRub(usage, config) : undefined;
    await failLiveBetaOperation({ db: runtimeEnv.FRIENDS_DB, operationId: body.operationId!, errorCode: known ? error.code : 'post_provider_processing_failed', uncertain: providerCalled && !billingFinal, actualCostRub: cost, usage, providerSessionId: known ? error.providerSessionId : undefined }).catch(() => undefined);
    try {
      if (fragment) {
        const active = [...(fragment.transcriptionAttempts ?? [])].reverse().find((item) => item.provider === PROVIDER_ID && (item.status === 'queued' || item.status === 'processing'));
        if (active) {
          fragment = failCaptureDraftTranscription(fragment, active.id, { code: known ? error.code : 'voice_turn_failed', message: 'Живой ИИ не завершил ответ. Оригинал сохранён; автоматического повтора не будет.' });
          draft = replaceDraftFragment(draft!, fragment.fragment.id, fragment);
          await saveDraft(runtimeEnv.FRIENDS_DB, identity.userId, state!, draft);
        }
      }
    } catch { /* The paid ledger remains the authoritative retry guard. */ }
    if (error instanceof StateConflictError) return NextResponse.json({ error: 'conflict', message: 'Материал изменился в другой вкладке. Платный вызов не повторяется автоматически.' }, { status: 409 });
    if (error instanceof FeedbackSubmissionError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    return NextResponse.json({ error: 'live_voice_failed', message: 'Живой ИИ не завершил ответ. Оригинал сохранён; автоматического повтора не будет.' }, { status: 502 });
  }
}
