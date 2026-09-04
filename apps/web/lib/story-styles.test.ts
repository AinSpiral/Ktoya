import { describe, expect, it } from 'vitest';
import { STORY_STYLES, isNarrativeStyle, styleInstruction } from './story-styles';
import { DeterministicAIProvider } from './deterministic-ai-provider';

describe('safe narrative style contracts', () => {
  it('has five distinct explicit instructions and a voice-preserving default', () => {
    expect(STORY_STYLES).toHaveLength(5);
    expect(new Set(STORY_STYLES.map(style => style.instruction)).size).toBe(5);
    expect(styleInstruction()).toBe(STORY_STYLES[0].instruction);
    expect(isNarrativeStyle('invent-dialogue')).toBe(false);
    expect(isNarrativeStyle({ id: 'warm' })).toBe(false);
  });
  it.each(STORY_STYLES)('$id fallback never pretends to generate literary facts', async style => {
    const text = 'я не помню год.  Мы встретились у реки';
    const result = await new DeterministicAIProvider().rephrase({ storyId: 'story-1', currentText: text, sources: [{ id: 'source-1', kind: 'typed', text }], askedQuestions: [], narrativeStyle: style.id });
    expect(result.value.storyText).toBe('Я не помню год. Мы встретились у реки.');
    expect(result.value.reason).toContain('только пробелы');
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.value.sourceIds).toEqual(['source-1']);
  });
});
