import type { ProviderJobResult, TranscriptionProvider, TTSProvider } from './adapters';
import type { CaptureDraftFragment, Story } from './domain';
import {
  completeCaptureDraftTranscription,
  completeNarration,
  completeTranscription,
  failCaptureDraftTranscription,
  failNarration,
  failTranscription,
  markCaptureDraftTranscriptionProcessing,
  markNarrationProcessing,
  markTranscriptionProcessing,
  queueCaptureDraftTranscription,
  queueNarration,
  queueTranscription,
} from './voice-logic';

type TranscriptionValue = { text: string };
type NarrationValue = { audio: ArrayBuffer; contentType: string; durationMs?: number; voiceId?: string };

function safeFailure(error: unknown, fallback: string) {
  return error instanceof Error && error.name === 'AbortError'
    ? { code: 'provider_timeout', message: fallback }
    : { code: 'provider_error', message: fallback };
}

/**
 * Runs one submit/poll step. Repeating this operation is safe: an active job is
 * polled, while a completed attempt is never duplicated.
 */
export async function processStoredTranscription(input: {
  story: Story;
  audioFragmentId: string;
  provider: TranscriptionProvider;
  loadAudio: (objectKey: string) => Promise<{ audio: ArrayBuffer; contentType: string }>;
}): Promise<Story> {
  let story = queueTranscription(input.story, { audioFragmentId: input.audioFragmentId, provider: input.provider.id });
  const attempt = [...(story.transcriptionAttempts ?? [])].reverse().find((item) =>
    item.audioFragmentId === input.audioFragmentId && item.provider === input.provider.id && (item.status === 'queued' || item.status === 'processing'));
  if (!attempt) return story;
  let result: ProviderJobResult<TranscriptionValue>;
  try {
    if (attempt.status === 'processing') {
      if (!attempt.externalJobId || !input.provider.poll) return story;
      result = await input.provider.poll(attempt.externalJobId);
    } else {
      const fragment = story.audioFragments?.find((item) => item.id === input.audioFragmentId);
      if (!fragment?.objectKey) return failTranscription(story, attempt.id, { code: 'audio_unavailable', message: 'Оригинал сохранён, но сейчас недоступен для распознавания.' });
      const audio = await input.loadAudio(fragment.objectKey);
      story = markTranscriptionProcessing(story, attempt.id);
      result = await input.provider.submit({ ...audio, language: 'ru-RU' });
    }
  } catch (error) {
    return failTranscription(story, attempt.id, safeFailure(error, 'Распознавание не завершилось. Оригинал сохранён; попытку можно повторить.'));
  }
  if (result.status === 'processing') return markTranscriptionProcessing(story, attempt.id, result.externalJobId);
  return completeTranscription(story, attempt.id, result.value.text);
}

/** Processes a saved recording before the capture draft becomes a Story. */
export async function processCaptureDraftTranscription(input: {
  fragment: CaptureDraftFragment;
  provider: TranscriptionProvider;
  loadAudio: (objectKey: string) => Promise<{ audio: ArrayBuffer; contentType: string }>;
}): Promise<CaptureDraftFragment> {
  let fragment = queueCaptureDraftTranscription(input.fragment, input.provider.id);
  const attempt = [...(fragment.transcriptionAttempts ?? [])].reverse().find((item) =>
    item.provider === input.provider.id && (item.status === 'queued' || item.status === 'processing'));
  if (!attempt) return fragment;
  let result: ProviderJobResult<TranscriptionValue>;
  try {
    if (attempt.status === 'processing') {
      if (!attempt.externalJobId || !input.provider.poll) return fragment;
      result = await input.provider.poll(attempt.externalJobId);
    } else {
      const objectKey = fragment.fragment.objectKey;
      if (!objectKey) return failCaptureDraftTranscription(fragment, attempt.id, { code: 'audio_unavailable', message: 'Оригинал сохранён, но сейчас недоступен для распознавания.' });
      const audio = await input.loadAudio(objectKey);
      fragment = markCaptureDraftTranscriptionProcessing(fragment, attempt.id);
      result = await input.provider.submit({ ...audio, language: 'ru-RU' });
    }
  } catch (error) {
    return failCaptureDraftTranscription(fragment, attempt.id, safeFailure(error, 'Распознавание не завершилось. Оригинал сохранён; попытку можно повторить.'));
  }
  if (result.status === 'processing') return markCaptureDraftTranscriptionProcessing(fragment, attempt.id, result.externalJobId);
  return completeCaptureDraftTranscription(fragment, attempt.id, result.value.text);
}

/** Generates or polls one cached narration for the exact current StoryRevision. */
export async function processStoryNarration(input: {
  story: Story;
  provider: TTSProvider;
  saveAudio: (narrationId: string, value: NarrationValue) => Promise<string>;
}): Promise<Story> {
  let story = queueNarration(input.story, input.provider.id);
  const narration = [...(story.narrations ?? [])].reverse().find((item) =>
    item.provider === input.provider.id && (item.status === 'queued' || item.status === 'processing'));
  if (!narration) return story;
  let result: ProviderJobResult<NarrationValue>;
  try {
    if (narration.status === 'processing') {
      if (!narration.externalJobId || !input.provider.poll) return story;
      result = await input.provider.poll(narration.externalJobId);
    } else {
      const revision = story.revisions.find((item) => item.id === narration.storyRevisionId);
      if (!revision) return failNarration(story, narration.id, { code: 'revision_unavailable', message: 'Версия истории не найдена; исходный текст не изменён.' });
      story = markNarrationProcessing(story, narration.id);
      result = await input.provider.submit({ text: revision.text, language: 'ru-RU' });
    }
  } catch (error) {
    return failNarration(story, narration.id, safeFailure(error, 'Озвучка не завершилась. Текст истории сохранён; генерацию можно повторить.'));
  }
  if (result.status === 'processing') return markNarrationProcessing(story, narration.id, result.externalJobId);
  try {
    const objectKey = await input.saveAudio(narration.id, result.value);
    return completeNarration(story, narration.id, { objectKey, contentType: result.value.contentType, durationMs: result.value.durationMs, voiceId: result.value.voiceId });
  } catch (error) {
    return failNarration(story, narration.id, safeFailure(error, 'Озвучка создана, но аудиофайл не удалось надёжно сохранить. Текст истории не изменён.'));
  }
}
