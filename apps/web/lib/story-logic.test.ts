import { describe, expect, it } from 'vitest';
import { createEmptyState } from './domain';
import { assembleStory, makeStory, startTrial, storyContainsOnlySources } from './story-logic';

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
