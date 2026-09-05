import { describe, expect, it } from 'vitest';
import { DeterministicAIProvider } from './deterministic-ai-provider';
import type { AIStoryContextInput } from './adapters';

const context: AIStoryContextInput = {
  storyId: 'story-qa', sources: [{ id: 'source-1', kind: 'typed', text: 'В субботу я собрал бумажный кораблик.' }], askedQuestions: [], currentText: 'в субботу  я собрал бумажный кораблик', currentRevisionId: 'revision-1',
};

describe('deterministic AI fallback', () => {
  it('asks non-repeating questions and stops at the hard limit', async () => {
    const provider = new DeterministicAIProvider();
    const first = await provider.nextInterviewStep(context);
    expect(first.value).toMatchObject({ decision: 'ASK', relatedSourceIds: ['source-1'] });
    const limited = await provider.nextInterviewStep({ ...context, askedQuestions: Array.from({ length: 8 }, (_, index) => ({ questionId: `q-${index}`, question: `Вопрос ${index}` })) });
    expect(limited.value.decision).toBe('READY');
  });

  it('does not repeat a question after the Author answers that they do not remember', async () => {
    const provider = new DeterministicAIProvider();
    const first = await provider.nextInterviewStep(context);
    const second = await provider.nextInterviewStep({ ...context, askedQuestions: [{ questionId: 'q-1', question: first.value.decision === 'ASK' ? first.value.question : '', answer: 'Не помню.' }] });
    expect(second.value.decision).toBe('ASK');
    if (first.value.decision === 'ASK' && second.value.decision === 'ASK') expect(second.value.question).not.toBe(first.value.question);
  });

  it('assembles only exact confirmed source text and keeps provenance', async () => {
    const proposal = await provider().assemble(context);
    expect(proposal.value.storyText).toBe(context.sources[0].text);
    expect(proposal.value.provenance).toEqual([{ segment: context.sources[0].text, sourceIds: ['source-1'] }]);
  });

  it('keeps an unsupported targeted instruction as a safe no-op', async () => {
    const proposal = await provider().patch(context, { expectedOldText: 'бумажный кораблик', instruction: 'Сделай красивее' });
    expect(proposal.value.replacementText).toBe('бумажный кораблик');
  });
});

function provider() { return new DeterministicAIProvider(); }
