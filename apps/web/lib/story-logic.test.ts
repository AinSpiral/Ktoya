import { describe, expect, it } from 'vitest';
import { createEmptyState, normalizeAppState } from './domain';
import { assembleStory, makeStory, nextFollowUpQuestion, startTrial, storyContainsOnlySources } from './story-logic';

describe('deterministic story assembly', () => {
  it('does not add a biographical claim', () => {
    const source = 'В субботу я впервые сам испёк хлеб с тмином.';
    const answers = [{ id: 'a1', question: 'Что важно?', answer: 'Мне было важно не сдаться после первой неудачи.' }];
    const result = assembleStory(source, answers);
    expect(result).toBe(`${source}\n\n${answers[0].answer}`);
    expect(storyContainsOnlySources(result, source, answers)).toBe(true);
    expect(result).not.toContain('детство');
    expect(result).not.toContain('семья');
  });

  it('keeps provenance for text and interview answer', () => {
    const story = makeStory({
      sourceText: 'Я сохранил старую открытку.',
      sourceMode: 'text',
      answers: [{ id: 'a2', question: 'Почему?', answer: 'Она напоминает мне о добром разговоре.' }],
    });
    expect(story.sources.map((source) => source.kind)).toEqual(['typed', 'interview-answer']);
    expect(story.revisions).toHaveLength(1);
    expect(story.privacy).toBe('private');
  });

  it('offers several non-repeating safe follow-up directions without inventing facts', () => {
    const first = nextFollowUpQuestion('Я помню этот день.', []);
    expect(first?.id).toBe('meaning');
    const second = nextFollowUpQuestion('Я помню этот день.', [{ id: 'a', questionId: first?.id, question: first?.question ?? '', answer: 'Это важно.' }]);
    expect(second?.id).toBe('people');
  });
});

describe('trial lifecycle', () => {
  it('starts only when explicitly called after a permanent save', () => {
    const empty = createEmptyState();
    expect(empty.trial.status).toBe('not-started');
    const started = startTrial(empty);
    expect(started.trial.status).toBe('active');
    expect(started.trial.startedAt).toBeTruthy();
    expect(started.trial.endsAt).toBeTruthy();
    expect((new Date(started.trial.endsAt!).getTime() - new Date(started.trial.startedAt!).getTime()) / 86_400_000).toBe(10);
  });
});

describe('book structure compatibility', () => {
  it('keeps a chapter layer ready for future manuscript import', () => {
    const state = createEmptyState();
    expect(state.book.chapterIds).toEqual([state.chapters[0].id]);
    expect(state.chapters[0]).toMatchObject({ kind: 'life-stories', storyIds: [] });
  });

  it('upgrades a saved flat Beta book without losing its stories', () => {
    const state = createEmptyState();
    const legacy = {
      ...state,
      version: 1,
      book: { ...state.book, storyIds: ['story-1'], chapterIds: undefined },
      chapters: undefined,
    } as unknown as Parameters<typeof normalizeAppState>[0];
    const normalized = normalizeAppState(legacy);
    expect(normalized.version).toBe(3);
    expect(normalized.chapters[0].storyIds).toEqual(['story-1']);
    expect(normalized.book.chapterIds).toEqual([normalized.chapters[0].id]);
  });
});
