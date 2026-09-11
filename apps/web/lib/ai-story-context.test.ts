import { describe, expect, it } from 'vitest';
import type { CaptureDraft } from './domain';
import { captureDraftSources, captureFragmentSourceId, captureTypedSourceId, contextForStory } from './ai-story-context';
import { assembleCaptureDraft } from './story-logic';

describe('current-story-only AI input', () => {
  it('uses stable source ids that survive assembly into a Story', () => {
    const now = '2026-08-23T12:00:00.000Z';
    const draft: CaptureDraft = {
      id: 'draft-1', sourceText: 'Синтетическая история без персональных данных.', answer: '', interviewAnswers: [],
      storyFragments: [{ fragment: { id: 'audio-1', position: 1, createdAt: now, contentType: 'audio/webm', uploadStatus: 'saved' }, rawTranscript: 'Контрольная запись.', transcript: 'Контрольная запись.' }],
      answerFragments: [], voiceAnswerDrafts: [], capturePurpose: 'story', updatedAt: now,
    };
    expect(captureDraftSources(draft).map((source) => source.id)).toEqual([captureTypedSourceId(draft.id), captureFragmentSourceId('audio-1')]);
    const story = assembleCaptureDraft(draft)!;
    expect(story.sources.map((source) => source.id)).toEqual(expect.arrayContaining([captureTypedSourceId(draft.id), captureFragmentSourceId('audio-1')]));
  });

  it('preserves raw transcript provenance without exposing obsolete text to the AI context', () => {
    const now = '2026-08-23T12:00:00.000Z';
    const draft: CaptureDraft = {
      id: 'draft-revisions', sourceText: '', answer: '', interviewAnswers: [],
      storyFragments: [{
        fragment: { id: 'audio-revisions', position: 1, createdAt: now, contentType: 'audio/webm', uploadStatus: 'saved', recognitionStatus: 'complete' },
        rawTranscript: 'сырой текст', transcript: 'Исправленный текст.',
      }],
      answerFragments: [], voiceAnswerDrafts: [], capturePurpose: 'story', updatedAt: now,
    };
    const story = assembleCaptureDraft(draft)!;
    const transcriptSources = story.sources.filter((source) => source.kind === 'transcript');

    expect(transcriptSources).toHaveLength(2);
    expect(transcriptSources.map((source) => source.transcriptRevisionId)).toEqual(story.transcriptRevisions?.map((revision) => revision.id));
    expect(contextForStory(story).sources.filter((source) => source.kind === 'transcript')).toEqual([
      expect.objectContaining({ id: captureFragmentSourceId('audio-revisions'), text: 'Исправленный текст.' }),
    ]);
  });

  it('never includes sources from another story', () => {
    const story = assembleCaptureDraft({ id: 'story-a', sourceText: 'Только история A.', answer: '', interviewAnswers: [], storyFragments: [], voiceAnswerDrafts: [] })!;
    const context = contextForStory(story);
    expect(context.storyId).toBe('story-a');
    expect(context.sources.every((source) => source.text.includes('история A'))).toBe(true);
  });
});
