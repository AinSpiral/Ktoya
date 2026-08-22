import { describe, expect, it } from 'vitest';
import { createEmptyState } from './domain';
import { migrateLegacyState } from './legacy-migration';
import { appendTranscriptRevision, makeStory, markAudioDeleted, markAudioHidden } from './story-logic';

describe('safe beta data model', () => {
  it('keeps the first audio fragment when a second one is added', () => {
    const story = makeStory({ sourceText: 'Первый фрагмент.', sourceMode: 'voice', answers: [] });
    const withFirst = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const withSecond = { ...withFirst, audioFragments: [...withFirst.audioFragments, { id: 'fragment-two', position: 2, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    expect(withSecond.audioFragments.map((item) => item.id)).toEqual(['fragment-one', 'fragment-two']);
  });

  it('does not delete transcript text when audio is deleted', () => {
    const story = makeStory({ sourceText: 'Текст остаётся.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const withTranscript = appendTranscriptRevision(withAudio, { audioFragmentId: 'fragment-one', text: 'Текст остаётся.', provider: 'manual' });
    const deleted = markAudioDeleted(withTranscript, 'fragment-one');
    expect(deleted.audioFragments?.[0].uploadStatus).toBe('deleted');
    expect(deleted.transcriptRevisions?.[0].text).toBe('Текст остаётся.');
    expect(deleted.sources.some((source) => source.text === 'Текст остаётся.')).toBe(true);
  });

  it('can hide and restore audio without changing saved text or deletion state', () => {
    const story = makeStory({ sourceText: 'Текст остаётся.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const withTranscript = appendTranscriptRevision(withAudio, { audioFragmentId: 'fragment-one', text: 'Текст остаётся.', provider: 'manual' });
    const hidden = markAudioHidden(withTranscript, 'fragment-one', true);
    const restored = markAudioHidden(hidden, 'fragment-one', false);
    expect(hidden.audioFragments?.[0]).toMatchObject({ uploadStatus: 'saved' });
    expect(hidden.audioFragments?.[0].hiddenAt).toBeTruthy();
    expect(restored.audioFragments?.[0].hiddenAt).toBeUndefined();
    expect(restored.transcriptRevisions?.[0].text).toBe('Текст остаётся.');
  });

  it('adds a second transcript revision without erasing the first', () => {
    const story = makeStory({ sourceText: '', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const first = appendTranscriptRevision(withAudio, { audioFragmentId: 'fragment-one', text: 'Первая версия.', provider: 'manual' });
    const second = appendTranscriptRevision(first, { audioFragmentId: 'fragment-one', text: 'Вторая версия.', provider: 'manual' });
    expect(second.transcriptRevisions?.map((item) => item.text)).toEqual(['Первая версия.', 'Вторая версия.']);
    expect(second.transcriptRevisions?.filter((item) => item.selected).map((item) => item.text)).toEqual(['Вторая версия.']);
  });

  it('keeps the voice-answer question link when retranscribing the same audio', () => {
    const story = makeStory({ sourceText: 'Первый ответ.', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'answer-audio', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const first = appendTranscriptRevision(withAudio, { audioFragmentId: 'answer-audio', text: 'Первая версия ответа.', provider: 'manual', questionId: 'question-2' });
    const second = appendTranscriptRevision(first, { audioFragmentId: 'answer-audio', text: 'Исправленная версия ответа.', provider: 'manual', questionId: 'question-2' });
    expect(second.transcriptRevisions?.map((item) => item.audioFragmentId)).toEqual(['answer-audio', 'answer-audio']);
    expect(second.transcriptRevisions?.map((item) => item.text)).toEqual(['Первая версия ответа.', 'Исправленная версия ответа.']);
    expect(second.sources.at(-1)).toMatchObject({
      questionId: 'question-2',
      audioFragmentId: 'answer-audio',
      transcriptRevisionId: second.transcriptRevisions?.at(-1)?.id,
    });
  });

  it('preserves a legacy story and maps its audio and transcript into linked objects', () => {
    const state = createEmptyState();
    const legacy = {
      ...state,
      version: 2,
      stories: [{ ...makeStory({ sourceText: 'Старая расшифровка.', sourceMode: 'voice', answers: [] }), audioKey: 'owner/story.webm' }],
    } as unknown as Parameters<typeof migrateLegacyState>[0];
    const result = migrateLegacyState(legacy);
    expect(result.state.stories).toHaveLength(1);
    expect(result.state.stories[0].audioFragments?.[0].objectKey).toBe('owner/story.webm');
    expect(result.state.stories[0].transcriptRevisions?.[0].text).toBe('Старая расшифровка.');
    expect(result.migratedStoryIds).toHaveLength(1);
  });
});
