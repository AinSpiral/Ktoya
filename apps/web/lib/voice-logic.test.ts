import { describe, expect, it } from 'vitest';
import type { CaptureDraftFragment, Story } from './domain';
import { appendStoryTextRevision } from './story-logic';
import {
  completeNarration,
  completeCaptureDraftTranscription,
  completeTranscription,
  currentStoryRevisionId,
  failNarration,
  failTranscription,
  hasStaleNarration,
  markNarrationProcessing,
  markCaptureDraftTranscriptionProcessing,
  markTranscriptionProcessing,
  narrationForCurrentRevision,
  queueNarration,
  queueCaptureDraftTranscription,
  queueTranscription,
} from './voice-logic';

function captureFragment(): CaptureDraftFragment {
  return {
    fragment: { id: 'draft-audio', position: 1, createdAt: '2026-08-23T10:00:00.000Z', contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'owner/draft/audio.webm', recognitionStatus: 'complete' },
    rawTranscript: 'браузерный исходник',
    transcript: 'ручная проверка',
  };
}

describe('capture draft production transcription', () => {
  it('keeps raw and manual versions, then adds production output before story assembly', () => {
    const original = captureFragment();
    const queued = queueCaptureDraftTranscription(original, 'provider-a');
    const attempt = queued.transcriptionAttempts![0];
    const processing = markCaptureDraftTranscriptionProcessing(queued, attempt.id, 'draft-job');
    const completed = completeCaptureDraftTranscription(processing, attempt.id, 'Качественная расшифровка.');

    expect(completed.fragment).toEqual(original.fragment);
    expect(completed.rawTranscript).toBe('браузерный исходник');
    expect(completed.transcriptRevisions).toHaveLength(3);
    expect(completed.transcriptRevisions?.map((revision) => revision.provider)).toEqual(['browser-speech-recognition', 'manual', 'production-stt']);
    expect(completed.transcriptRevisions?.[0]).toMatchObject({ revisionKind: 'raw', selected: false });
    expect(completed.transcriptRevisions?.[1]).toMatchObject({ basedOnRevisionId: completed.transcriptRevisions?.[0].id, selected: false });
    expect(completed.transcriptRevisions?.[2]).toMatchObject({ basedOnRevisionId: completed.transcriptRevisions?.[0].id, selected: true });
    expect(completed.transcriptionAttempts?.[0]).toMatchObject({ status: 'ready', externalJobId: 'draft-job', resultRevisionId: completed.transcriptRevisions?.[2].id });
    expect(completed.transcript).toBe('Качественная расшифровка.');
  });
});

function voiceStory(): Story {
  return {
    id: 'story-voice',
    title: 'Голосовая история',
    text: 'сырой текст ответа',
    sourceMode: 'voice',
    sources: [{ id: 'source-raw', kind: 'transcript', text: 'сырой текст ответа', createdAt: '2026-08-23T10:00:00.000Z', audioFragmentId: 'audio-answer', transcriptRevisionId: 'transcript-raw', questionId: 'meaning' }],
    interviewAnswers: [{ id: 'answer-1', questionId: 'meaning', question: 'Что важно?', answer: 'сырой текст ответа', audioFragmentId: 'audio-answer', audioFragmentIds: ['audio-answer'], transcriptRevisionId: 'transcript-raw', transcriptRevisionIds: ['transcript-raw'] }],
    revisions: [{ id: 'story-revision-raw', text: 'сырой текст ответа', createdAt: '2026-08-23T10:00:00.000Z', reason: 'assembled' }],
    privacy: 'private',
    createdAt: '2026-08-23T10:00:00.000Z',
    updatedAt: '2026-08-23T10:00:00.000Z',
    confirmedAt: '2026-08-23T10:00:00.000Z',
    audioFragments: [{ id: 'audio-answer', position: 1, createdAt: '2026-08-23T10:00:00.000Z', contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'owner/story/audio.webm', recognitionStatus: 'complete' }],
    transcriptRevisions: [{ id: 'transcript-raw', audioFragmentId: 'audio-answer', text: 'сырой текст ответа', provider: 'browser-speech-recognition', revisionKind: 'raw', createdAt: '2026-08-23T10:00:00.000Z', selected: true, verificationStatus: 'unverified', completenessStatus: 'complete' }],
  };
}

describe('production transcription state transitions', () => {
  it('adds an improved revision and StoryRevision without changing audio, raw transcript, questionId or provenance', () => {
    const original = voiceStory();
    const queued = queueTranscription(original, { audioFragmentId: 'audio-answer', provider: 'provider-a' });
    const attempt = queued.transcriptionAttempts?.[0];
    expect(attempt).toMatchObject({ status: 'queued', basedOnRevisionId: 'transcript-raw' });

    const processing = markTranscriptionProcessing(queued, attempt!.id, 'provider-job-1');
    const completed = completeTranscription(processing, attempt!.id, 'Улучшенный текст ответа.');
    const production = completed.transcriptRevisions?.at(-1);

    expect(completed.audioFragments).toEqual(original.audioFragments);
    expect(completed.transcriptRevisions?.[0]).toMatchObject({ id: 'transcript-raw', text: 'сырой текст ответа', revisionKind: 'raw', selected: false });
    expect(production).toMatchObject({ provider: 'production-stt', revisionKind: 'improved', basedOnRevisionId: 'transcript-raw', selected: true });
    expect(completed.transcriptionAttempts?.[0]).toMatchObject({ status: 'ready', resultRevisionId: production?.id, externalJobId: 'provider-job-1' });
    expect(completed.interviewAnswers[0]).toMatchObject({ questionId: 'meaning', audioFragmentId: 'audio-answer', transcriptRevisionId: production?.id, answer: 'Улучшенный текст ответа.' });
    expect(completed.sources.at(-1)).toMatchObject({ questionId: 'meaning', audioFragmentId: 'audio-answer', transcriptRevisionId: production?.id });
    expect(completed.revisions).toHaveLength(2);
    expect(completed.text).toBe('Улучшенный текст ответа.');
  });

  it('preserves every source when processing fails and permits a later retry', () => {
    const original = voiceStory();
    const queued = queueTranscription(original, { audioFragmentId: 'audio-answer', provider: 'provider-a' });
    const failed = failTranscription(queued, queued.transcriptionAttempts![0].id, { code: 'provider_timeout', message: 'Не удалось завершить распознавание.' });
    const retried = queueTranscription(failed, { audioFragmentId: 'audio-answer', provider: 'provider-a' });

    expect(failed.audioFragments).toEqual(original.audioFragments);
    expect(failed.transcriptRevisions).toEqual(original.transcriptRevisions);
    expect(failed.revisions).toEqual(original.revisions);
    expect(failed.transcriptionAttempts?.[0]).toMatchObject({ status: 'failed', errorCode: 'provider_timeout' });
    expect(retried.transcriptionAttempts).toHaveLength(2);
  });

  it('does not duplicate an active retry', () => {
    const queued = queueTranscription(voiceStory(), { audioFragmentId: 'audio-answer', provider: 'provider-a' });
    expect(queueTranscription(queued, { audioFragmentId: 'audio-answer', provider: 'provider-a' })).toBe(queued);
  });
});

describe('production narration cache and revision binding', () => {
  it('keeps a ready seekable asset tied to the exact StoryRevision across reload-shaped data', () => {
    const original = voiceStory();
    const queued = queueNarration(original, 'provider-a');
    const narrationId = queued.narrations![0].id;
    const processing = markNarrationProcessing(queued, narrationId, 'tts-job-1');
    const ready = completeNarration(processing, narrationId, { objectKey: 'owner/story/narration.mp3', contentType: 'audio/mpeg', durationMs: 42_000, voiceId: 'neutral-ru' });

    expect(ready.narrations?.[0]).toMatchObject({ status: 'ready', storyRevisionId: 'story-revision-raw', objectKey: 'owner/story/narration.mp3', externalJobId: 'tts-job-1' });
    expect(narrationForCurrentRevision(JSON.parse(JSON.stringify(ready)) as Story)?.objectKey).toBe('owner/story/narration.mp3');
    expect(queueNarration(ready, 'provider-a')).toBe(ready);
  });

  it('retains old audio but never presents it as current after a text edit', () => {
    const queued = queueNarration(voiceStory(), 'provider-a');
    const ready = completeNarration(queued, queued.narrations![0].id, { objectKey: 'owner/story/old.mp3', contentType: 'audio/mpeg' });
    const edited = appendStoryTextRevision(ready, 'Новая видимая версия истории.');

    expect(currentStoryRevisionId(edited)).not.toBe(ready.narrations?.[0].storyRevisionId);
    expect(edited.narrations?.[0].objectKey).toBe('owner/story/old.mp3');
    expect(narrationForCurrentRevision(edited)).toBeNull();
    expect(hasStaleNarration(edited)).toBe(true);
    expect(queueNarration(edited, 'provider-a').narrations).toHaveLength(2);
  });

  it('records a generation error without losing prior StoryRevisions', () => {
    const original = voiceStory();
    const queued = queueNarration(original, 'provider-a');
    const failed = failNarration(queued, queued.narrations![0].id, { code: 'provider_error', message: 'Не удалось создать озвучку.' });
    expect(failed.revisions).toEqual(original.revisions);
    expect(failed.narrations?.[0]).toMatchObject({ status: 'failed', errorCode: 'provider_error' });
  });
});
