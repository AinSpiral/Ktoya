import { describe, expect, it, vi } from 'vitest';
import { AliceAIProvider } from './alice-ai-provider';
import type { AIStoryContextInput } from './adapters';

const context: AIStoryContextInput = { storyId: 'qa-story', sources: [{ id: 'source-1', kind: 'typed', text: 'Синтетический рассказ.' }], askedQuestions: [] };

function dbWithReservation(found = true) {
  const row = found ? { operation_id: 'op-1', user_id: 'qa-user', kind: 'interview-next', provider: 'yandex-ai-studio', model: 'aliceai-llm', story_id: null, capture_draft_id: 'qa-story', base_revision_id: null, source_ids_json: '["source-1"]', qa_nonpersonal: 1, max_cost_microrub: 1000000, actual_cost_microrub: null, status: 'reserved', input_tokens: null, output_tokens: null, result_preview_id: null, created_revision_id: null, error_code: null } : null;
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(row) })) })) } as unknown as D1Database;
}

describe('Alice AI adapter boundary', () => {
  it('rejects a direct provider call without a matching reserved operation before fetch', async () => {
    const fetcher = vi.fn();
    const provider = new AliceAIProvider({ apiKey: 'hidden', folderId: 'folder', model: 'aliceai-llm' }, { db: dbWithReservation(false), userId: 'qa-user', operationId: 'op-1' }, fetcher);
    await expect(provider.nextInterviewStep(context)).rejects.toThrow('reserved nonpersonal');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends JSON Schema and validates the structured response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ decision: 'ASK', question: 'Какая деталь запомнилась?', anchorQuote: 'Синтетический рассказ', category: 'detail', purpose: 'Уточнить деталь', relatedSourceIds: ['source-1'], reason: '' }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    }), { status: 200 }));
    const provider = new AliceAIProvider({ apiKey: 'hidden', folderId: 'folder', model: 'aliceai-llm' }, { db: dbWithReservation(), userId: 'qa-user', operationId: 'op-1' }, fetcher);
    await expect(provider.nextInterviewStep(context)).resolves.toMatchObject({ value: { decision: 'ASK' }, usage: { inputTokens: 120, outputTokens: 40 } });
    const request = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(fetcher.mock.calls[0][1].headers['x-data-logging-enabled']).toBe('false');
    expect(request.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(request.messages[0].content).toContain('двусмысленное слово');
    expect(JSON.stringify(request)).not.toContain('hidden');
  });

  it('classifies invalid provider output without exposing its content', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"unexpected":"personal text is not echoed"}' } }] }), { status: 200 }));
    const provider = new AliceAIProvider({ apiKey: 'hidden', folderId: 'folder', model: 'aliceai-llm' }, { db: dbWithReservation(), userId: 'qa-user', operationId: 'op-1' }, fetcher);
    await expect(provider.nextInterviewStep(context)).rejects.toMatchObject({ code: 'provider_schema_invalid', message: 'provider_schema_invalid' });
  });
});
