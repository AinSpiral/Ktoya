import { describe, expect, it } from 'vitest';
import { assertNoUnsupportedLexicalAnchors } from './ai-output-safety';
import type { AIStoryContextInput } from './adapters';

const context: AIStoryContextInput = {
  storyId: 'synthetic', sources: [{ id: 'source-1', kind: 'typed', text: 'Команда проверила четыре детали 17 июня 2032 года.' }],
  askedQuestions: [], currentText: 'Команда проверила четыре детали 17 июня 2032 года.', currentRevisionId: 'revision-1',
};

describe('AI lexical safety anchors', () => {
  it('allows Russian rephrasing while preserving confirmed numbers', () => {
    expect(() => assertNoUnsupportedLexicalAnchors(context, '17 июня 2032 года команда проверила четыре детали.')).not.toThrow();
  });

  it('rejects a leaked Latin token or an unconfirmed number before preview/apply', () => {
    expect(() => assertNoUnsupportedLexicalAnchors(context, 'Команда Normally проверила детали 17 июня 2032 года.')).toThrow('unsupported lexical anchors');
    expect(() => assertNoUnsupportedLexicalAnchors(context, 'Команда проверила 5 деталей 17 июня 2032 года.')).toThrow('unsupported lexical anchors');
  });
});
