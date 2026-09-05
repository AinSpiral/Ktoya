import { describe, expect, it } from 'vitest';
import { AI_RESPONSE_SCHEMAS, parseAssemblyProposal, parseInterviewDecision, parseTargetedPatch, responseSchemaFor } from './ai-schemas';

describe('AI structured-output validation', () => {
  it('requires provenance-bearing provider outputs to name at least one source', () => {
    expect(AI_RESPONSE_SCHEMAS.assembly.properties.provenance.items.properties.sourceIds).toMatchObject({ minItems: 1, maxItems: 64 });
    expect(AI_RESPONSE_SCHEMAS.rephrase.properties.sourceIds).toMatchObject({ minItems: 1 });
    expect(AI_RESPONSE_SCHEMAS.patch.properties.sourceIds).toMatchObject({ minItems: 1 });
  });

  it('restricts provider source references to the exact current-story source ids', () => {
    const allowed = ['source:typed:story-a', 'source:audio:fragment-a'];
    expect(responseSchemaFor('interview', allowed).properties.relatedSourceIds!.items.enum).toEqual(allowed);
    expect(responseSchemaFor('assembly', allowed).properties.provenance!.items.properties.sourceIds.items.enum).toEqual(allowed);
    expect(responseSchemaFor('rephrase', allowed).properties.sourceIds!.items.enum).toEqual(allowed);
    expect(responseSchemaFor('patch', allowed).properties.sourceIds!.items.enum).toEqual(allowed);
    expect(responseSchemaFor('patch', allowed, 'точный фрагмент').properties.expectedOldText!.const).toBe('точный фрагмент');
  });
  it('accepts one purposeful ASK or an explicit READY decision', () => {
    expect(parseInterviewDecision({ decision: 'ASK', question: 'Какую деталь ты помнишь точнее всего?', anchorQuote: 'этот момент', category: 'detail', purpose: 'Уточнить подтверждённую деталь', relatedSourceIds: ['source-1'], reason: '' })).toMatchObject({ decision: 'ASK', anchorQuote: 'этот момент', relatedSourceIds: ['source-1'] });
    expect(parseInterviewDecision({ decision: 'READY', question: '', anchorQuote: '', category: 'gap', purpose: '', relatedSourceIds: [], reason: 'Материала достаточно.' })).toEqual({ decision: 'READY', reason: 'Материала достаточно.' });
  });

  it('rejects free-form or extra model fields before they become application commands', () => {
    expect(() => parseInterviewDecision('Спроси автора о детстве')).toThrow('must be an object');
    expect(() => parseInterviewDecision({ decision: 'ASK', question: 'Что случилось?', anchorQuote: 'фрагмент', category: 'gap', purpose: 'Уточнение', relatedSourceIds: ['source-1'], reason: '', command: 'delete_story' })).toThrow('invalid shape');
  });

  it('requires assembly provenance and a complete exact-match patch', () => {
    expect(() => parseAssemblyProposal({ title: 'История', storyText: 'Текст', provenance: [], uncertainties: [] })).toThrow('incomplete');
    expect(parseTargetedPatch({ expectedOldText: 'старый фрагмент', replacementText: 'новый фрагмент', reason: 'Исправление формулировки', sourceIds: ['source-1'] })).toMatchObject({ expectedOldText: 'старый фрагмент' });
  });
});
