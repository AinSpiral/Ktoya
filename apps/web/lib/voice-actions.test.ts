import { describe, expect, it, vi } from 'vitest';
import type { TranscriptionProvider, TTSProvider } from './adapters';
import type { CaptureDraftFragment, Story } from './domain';
import { processCaptureDraftTranscription, processStoredTranscription, processStoryNarration } from './voice-actions';

function story(): Story {
  return {
    id: 'story-1', title: 'История', text: 'сырой текст', sourceMode: 'voice', privacy: 'private',
    createdAt: '2026-08-23T10:00:00.000Z', updatedAt: '2026-08-23T10:00:00.000Z', confirmedAt: '2026-08-23T10:00:00.000Z',
    sources: [{ id: 'source-1', kind: 'transcript', text: 'сырой текст', createdAt: '2026-08-23T10:00:00.000Z', audioFragmentId: 'audio-1', transcriptRevisionId: 'raw-1' }],
    interviewAnswers: [],
    revisions: [{ id: 'story-revision-1', text: 'сырой текст', createdAt: '2026-08-23T10:00:00.000Z', reason: 'assembled' }],
    audioFragments: [{ id: 'audio-1', position: 1, createdAt: '2026-08-23T10:00:00.000Z', contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'owner/story/audio.webm' }],
    transcriptRevisions: [{ id: 'raw-1', audioFragmentId: 'audio-1', text: 'сырой текст', provider: 'browser-speech-recognition', revisionKind: 'raw', createdAt: '2026-08-23T10:00:00.000Z', selected: true }],
  };
}

describe('voice provider orchestration', () => {
  it('processes an already uploaded capture draft without requiring a finished Story', async () => {
    const fragment: CaptureDraftFragment = {
      fragment: { id: 'draft-audio', position: 1, createdAt: '2026-08-23T10:00:00.000Z', contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'owner/draft/audio.webm' },
      rawTranscript: 'сырой браузерный текст',
      transcript: 'сырой браузерный текст',
    };
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      submit: vi.fn().mockResolvedValue({ status: 'ready', value: { text: 'Качественный текст.' } }),
    };
    const loadAudio = vi.fn().mockResolvedValue({ audio: new ArrayBuffer(8), contentType: 'audio/webm' });
    const result = await processCaptureDraftTranscription({ fragment, provider, loadAudio });

    expect(loadAudio).toHaveBeenCalledWith('owner/draft/audio.webm');
    expect(result.fragment).toEqual(fragment.fragment);
    expect(result.transcriptRevisions?.map((revision) => revision.provider)).toEqual(['browser-speech-recognition', 'production-stt']);
    expect(result.transcriptionAttempts?.[0].status).toBe('ready');
  });

  it('passes saved media to STT and applies an immediate result additively', async () => {
    const provider: TranscriptionProvider = {
      id: 'fake-stt',
      submit: vi.fn().mockResolvedValue({ status: 'ready', value: { text: 'Улучшенный текст.' } }),
    };
    const loadAudio = vi.fn().mockResolvedValue({ audio: new ArrayBuffer(8), contentType: 'audio/webm' });
    const result = await processStoredTranscription({ story: story(), audioFragmentId: 'audio-1', provider, loadAudio });

    expect(loadAudio).toHaveBeenCalledWith('owner/story/audio.webm');
    expect(provider.submit).toHaveBeenCalledWith(expect.objectContaining({ language: 'ru-RU', contentType: 'audio/webm' }));
    expect(result.transcriptionAttempts?.[0].status).toBe('ready');
    expect(result.transcriptRevisions).toHaveLength(2);
    expect(result.transcriptRevisions?.[0].id).toBe('raw-1');
  });

  it('persists an external STT job and polls it on the next call without resubmitting audio', async () => {
    const provider: TranscriptionProvider = {
      id: 'fake-async-stt',
      submit: vi.fn().mockResolvedValue({ status: 'processing', externalJobId: 'job-1' }),
      poll: vi.fn().mockResolvedValue({ status: 'ready', value: { text: 'Готовый текст.' } }),
    };
    const loadAudio = vi.fn().mockResolvedValue({ audio: new ArrayBuffer(8), contentType: 'audio/webm' });
    const processing = await processStoredTranscription({ story: story(), audioFragmentId: 'audio-1', provider, loadAudio });
    const ready = await processStoredTranscription({ story: processing, audioFragmentId: 'audio-1', provider, loadAudio });

    expect(processing.transcriptionAttempts?.[0]).toMatchObject({ status: 'processing', externalJobId: 'job-1' });
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(provider.poll).toHaveBeenCalledWith('job-1');
    expect(loadAudio).toHaveBeenCalledTimes(1);
    expect(ready.transcriptionAttempts?.[0].status).toBe('ready');
  });

  it('stores TTS bytes as a reusable asset linked to the exact StoryRevision', async () => {
    const provider: TTSProvider = {
      id: 'fake-tts',
      submit: vi.fn().mockResolvedValue({ status: 'ready', value: { audio: new ArrayBuffer(16), contentType: 'audio/mpeg', durationMs: 12_000, voiceId: 'ru-neutral' } }),
    };
    const saveAudio = vi.fn().mockResolvedValue('owner/story/narration.mp3');
    const result = await processStoryNarration({ story: story(), provider, saveAudio });

    expect(provider.submit).toHaveBeenCalledWith({ text: 'сырой текст', language: 'ru-RU' });
    expect(saveAudio).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ contentType: 'audio/mpeg', voiceId: 'ru-neutral' }));
    expect(result.narrations?.[0]).toMatchObject({ status: 'ready', storyRevisionId: 'story-revision-1', objectKey: 'owner/story/narration.mp3' });
  });

  it('records a safe failure when a provider rejects without changing the original', async () => {
    const original = story();
    const provider: TranscriptionProvider = { id: 'fake-stt', submit: vi.fn().mockRejectedValue(new Error('secret provider payload')) };
    const result = await processStoredTranscription({ story: original, audioFragmentId: 'audio-1', provider, loadAudio: async () => ({ audio: new ArrayBuffer(1), contentType: 'audio/webm' }) });

    expect(result.audioFragments).toEqual(original.audioFragments);
    expect(result.transcriptRevisions).toEqual(original.transcriptRevisions);
    expect(result.transcriptionAttempts?.[0]).toMatchObject({ status: 'failed', errorCode: 'provider_error' });
    expect(result.transcriptionAttempts?.[0].errorMessage).not.toContain('secret provider payload');
  });
});
