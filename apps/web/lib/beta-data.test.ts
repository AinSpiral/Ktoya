import { describe, expect, it } from 'vitest';
import { createEmptyState } from './domain';
import { migrateLegacyState } from './legacy-migration';
import { appendTranscriptRevision, makeStory, markAudioDeleted } from './story-logic';

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

  it('adds a second transcript revision without erasing the first', () => {
    const story = makeStory({ sourceText: '', sourceMode: 'voice', answers: [] });
    const withAudio = { ...story, audioFragments: [{ id: 'fragment-one', position: 1, createdAt: story.createdAt, contentType: 'audio/webm' as const, uploadStatus: 'saved' as const }] };
    const first = appendTranscriptRevision(withAudio, { audioFragmentId: 'fragment-one', text: 'Первая версия.', provider: 'manual' });
    const second = appendTranscriptRevision(first, { audioFragmentId: 'fragment-one', text: 'Вторая версия.', provider: 'manual' });
    expect(second.transcriptRevisions?.map((item) => item.text)).toEqual(['Первая версия.', 'Вторая версия.']);
    expect(second.transcriptRevisions?.filter((item) => item.selected).map((item) => item.text)).toEqual(['Вторая версия.']);
  });

  it('preserves a legacy story and maps its audio and transcript into linked objects', () => {
    const state = createEmptyState();
    const legacy = {
      ...state,
      version: 2,
      stories: [{ ...makeStory({ sourceText: 'Старая расшифровка.', sourceMode: 'voice', answers: [] }), audioKey: 'owner/story.webm' }],
    } as Parameters<typeof migrateLegacyState>[0];
    const result = migrateLegacyState(legacy);
    expect(result.state.stories).toHaveLength(1);
    expect(result.state.stories[0].audioFragments?.[0].objectKey).toBe('owner/story.webm');
    expect(result.state.stories[0].transcriptRevisions?.[0].text).toBe('Старая расшифровка.');
    expect(result.migratedStoryIds).toHaveLength(1);
  });
});
