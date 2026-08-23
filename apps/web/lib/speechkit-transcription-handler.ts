import { NextRequest, NextResponse } from 'next/server';
import type { AppState, CaptureDraft, CaptureDraftFragment, Story, TranscriptProcessingMode, TranscriptionAttempt } from './domain';
import { authenticatedUserId } from './server-auth';
import { loadAuthorState, saveAuthorState, StateConflictError } from './server-state';
import { YandexSpeechKitTranscriptionProvider } from './speechkit-provider';
import { readSpeechKitTrialConfig } from './voice-trial-config';
import { estimateAsyncSttRub, markTrialOperation, reserveTrialOperation } from './voice-trial-budget';
import { qaTrialAudioEligibility } from './voice-trial-policy';
import { completeCaptureDraftTranscription, completeTranscription, failCaptureDraftTranscription, failTranscription, markCaptureDraftTranscriptionProcessing, markTranscriptionProcessing, queueCaptureDraftTranscription, queueTranscription } from './voice-logic';

const PROVIDER_ID = 'yandex-speechkit-v3';

function activeAttempt(attempts: TranscriptionAttempt[] | undefined, fragmentId: string) {
  return [...(attempts ?? [])].reverse().find((item) => item.audioFragmentId === fragmentId && item.provider === PROVIDER_ID && (item.status === 'queued' || item.status === 'processing'));
}

function replaceDraftFragment(draft: CaptureDraft, fragmentId: string, next: CaptureDraftFragment) {
  const replace = (item: CaptureDraftFragment) => item.fragment.id === fragmentId ? next : item;
  return { ...draft, storyFragments: draft.storyFragments.map(replace), answerFragments: draft.answerFragments.map(replace), voiceAnswerDrafts: draft.voiceAnswerDrafts.map((answer) => ({ ...answer, fragments: answer.fragments.map(replace) })), updatedAt: new Date().toISOString() };
}

async function saveStory(db: D1Database, userId: string, state: AppState, story: Story) {
  return saveAuthorState(db, userId, { ...state, stories: state.stories.map((item) => item.id === story.id ? story : item), updatedAt: story.updatedAt });
}

async function saveDraft(db: D1Database, userId: string, state: AppState, draft: CaptureDraft) {
  return saveAuthorState(db, userId, { ...state, captureDrafts: state.captureDrafts?.map((item) => item.id === draft.id ? draft : item), updatedAt: draft.updatedAt });
}

export async function handleSpeechKitTranscription(request: NextRequest, runtimeEnv: Cloudflare.Env) {
  const userId = authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!userId) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const config = readSpeechKitTrialConfig(runtimeEnv);
  if (!config) return NextResponse.json({ error: 'provider_not_configured', message: 'SpeechKit trial заблокирован до проверки тарифа billing account, установки ограниченного ключа и защищённой конфигурации.' }, { status: 503 });
  const body = await request.json() as { storyId?: string; captureDraftId?: string; audioFragmentId?: string; processingMode?: TranscriptProcessingMode };
  if ((!body.storyId && !body.captureDraftId) || !body.audioFragmentId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (body.processingMode && body.processingMode !== 'faithful') return NextResponse.json({ error: 'literature_mode_not_canonical', message: 'LiteratureText не включается в canonical trial. Для него потребуется отдельный derived revision flow.' }, { status: 400 });

  try {
    let state = await loadAuthorState(runtimeEnv.DB, userId);
    if (!state) return NextResponse.json({ error: 'book_not_found' }, { status: 404 });
    let story = body.storyId ? state.stories.find((item) => item.id === body.storyId) : undefined;
    let draft = body.captureDraftId ? state.captureDrafts?.find((item) => item.id === body.captureDraftId) : undefined;
    if (body.storyId && !story) return NextResponse.json({ error: 'story_not_found' }, { status: 404 });
    if (body.captureDraftId && !draft) return NextResponse.json({ error: 'capture_draft_not_found' }, { status: 404 });

    let captureFragment = draft ? [...draft.storyFragments, ...draft.answerFragments, ...draft.voiceAnswerDrafts.flatMap((answer) => answer.fragments)].find((item) => item.fragment.id === body.audioFragmentId) : undefined;
    const audioFragment = story?.audioFragments?.find((item) => item.id === body.audioFragmentId) ?? captureFragment?.fragment;
    if (!audioFragment) return NextResponse.json({ error: 'audio_fragment_not_found' }, { status: 404 });
    const eligibility = qaTrialAudioEligibility({ fragment: audioFragment, ownerPolicy: story?.externalProcessingPolicy ?? draft?.externalProcessingPolicy });
    if (!eligibility.eligible && eligibility.reason === 'qa_only') {
      return NextResponse.json({ error: 'qa_only', message: 'SpeechKit trial не принимает старые или личные материалы. Ничего не отправлено.' }, { status: 403 });
    }
    if (!eligibility.eligible) return NextResponse.json({ error: 'derived_audio_required', message: 'Оригинал сохранён, но отдельный WAV/OGG derived asset для SpeechKit ещё не готов.' }, { status: 409 });
    const derived = eligibility.derived;
    if (!derived.objectKey.startsWith(`${userId}/`) || derived.sourceAudioFragmentId !== audioFragment.id) return NextResponse.json({ error: 'derived_audio_ownership_mismatch' }, { status: 403 });

    let attempt = story ? activeAttempt(story.transcriptionAttempts, audioFragment.id) : activeAttempt(captureFragment?.transcriptionAttempts, audioFragment.id);
    if (!attempt && story) {
      story = queueTranscription(story, { audioFragmentId: audioFragment.id, provider: PROVIDER_ID });
      attempt = activeAttempt(story.transcriptionAttempts, audioFragment.id)!;
      story = { ...story, transcriptionAttempts: story.transcriptionAttempts?.map((item) => item.id === attempt!.id ? { ...item, processingMode: 'faithful', derivedAudioAssetId: derived.id, billingOperationId: attempt!.id } : item) };
      state = await saveStory(runtimeEnv.DB, userId, state, story);
      story = state.stories.find((item) => item.id === story!.id)!;
      attempt = activeAttempt(story.transcriptionAttempts, audioFragment.id)!;
    } else if (!attempt && draft && captureFragment) {
      captureFragment = queueCaptureDraftTranscription(captureFragment, PROVIDER_ID);
      attempt = activeAttempt(captureFragment.transcriptionAttempts, audioFragment.id)!;
      captureFragment = { ...captureFragment, transcriptionAttempts: captureFragment.transcriptionAttempts?.map((item) => item.id === attempt!.id ? { ...item, processingMode: 'faithful', derivedAudioAssetId: derived.id, billingOperationId: attempt!.id } : item) };
      draft = replaceDraftFragment(draft, audioFragment.id, captureFragment);
      state = await saveDraft(runtimeEnv.DB, userId, state, draft);
      const savedDraft = state.captureDrafts?.find((item) => item.id === draft!.id);
      if (!savedDraft) throw new Error('Capture draft disappeared after save.');
      draft = savedDraft;
      captureFragment = [...draft.storyFragments, ...draft.answerFragments, ...draft.voiceAnswerDrafts.flatMap((answer) => answer.fragments)].find((item) => item.fragment.id === audioFragment.id)!;
      attempt = activeAttempt(captureFragment.transcriptionAttempts, audioFragment.id)!;
    }
    if (!attempt) throw new Error('Failed to persist transcription attempt.');

    const operationId = attempt.billingOperationId ?? attempt.id;
    const provider = new YandexSpeechKitTranscriptionProvider(config.apiKey, { db: runtimeEnv.DB, userId, operationId, sourceId: derived.id });
    let completedExternalJobId: string | undefined;
    if (attempt.status === 'processing' && attempt.externalJobId) {
      const result = await provider.poll(attempt.externalJobId);
      if (result.status === 'processing') return NextResponse.json(state);
      completedExternalJobId = attempt.externalJobId;
      if (story) story = completeTranscription(story, attempt.id, result.value.text);
      else if (captureFragment && draft) { captureFragment = completeCaptureDraftTranscription(captureFragment, attempt.id, result.value.text); draft = replaceDraftFragment(draft, audioFragment.id, captureFragment); }
    } else {
      if (!audioFragment.durationMs) throw new Error('Audio duration disappeared before reservation.');
      const reservation = await reserveTrialOperation({ db: runtimeEnv.DB, operationId, userId, kind: 'stt', sourceId: derived.id, qaNonpersonalVerified: true, maxCostRub: estimateAsyncSttRub(audioFragment.durationMs, config.sttRubPerSecond), capRub: config.capRub });
      if (!reservation.claimed) {
        const message = reservation.operation ? 'Эта платная операция уже была зарезервирована и не повторяется автоматически.' : `Лимит SpeechKit trial исчерпан (${reservation.reservedTotalRub.toFixed(4)} ₽ зарезервировано).`;
        if (story) story = failTranscription(story, attempt.id, { code: 'trial_reservation_blocked', message });
        else if (captureFragment && draft) { captureFragment = failCaptureDraftTranscription(captureFragment, attempt.id, { code: 'trial_reservation_blocked', message }); draft = replaceDraftFragment(draft, audioFragment.id, captureFragment); }
      } else {
        const object = await runtimeEnv.STORY_MEDIA.get(derived.objectKey);
        if (!object) throw new Error('Derived audio not found.');
        try {
          const result = await provider.submit({ audio: await object.arrayBuffer(), contentType: derived.contentType, language: 'ru-RU', literatureText: false });
          if (result.status !== 'processing') throw new Error('Unexpected synchronous STT result.');
          await markTrialOperation({ db: runtimeEnv.DB, operationId, status: 'submitted', externalJobId: result.externalJobId });
          if (story) story = markTranscriptionProcessing(story, attempt.id, result.externalJobId);
          else if (captureFragment && draft) { captureFragment = markCaptureDraftTranscriptionProcessing(captureFragment, attempt.id, result.externalJobId); draft = replaceDraftFragment(draft, audioFragment.id, captureFragment); }
        } catch (error) {
          await markTrialOperation({ db: runtimeEnv.DB, operationId, status: 'uncertain' });
          throw error;
        }
      }
    }
    let savedState: AppState;
    if (story) savedState = await saveStory(runtimeEnv.DB, userId, state, story);
    else if (draft) savedState = await saveDraft(runtimeEnv.DB, userId, state, draft);
    else throw new Error('Voice source disappeared.');
    if (completedExternalJobId) {
      await markTrialOperation({ db: runtimeEnv.DB, operationId, status: 'completed', externalJobId: completedExternalJobId });
    }
    return NextResponse.json(savedState);
  } catch (error) {
    if (error instanceof StateConflictError) return NextResponse.json({ error: 'conflict', message: 'Материал изменился в другой вкладке. Ничего не отправлено повторно.' }, { status: 409 });
    return NextResponse.json({ error: 'voice_operation_failed', message: 'SpeechKit не завершил распознавание. Оригинал и все предыдущие версии сохранены; платный вызов не повторяется автоматически.' }, { status: 502 });
  }
}
