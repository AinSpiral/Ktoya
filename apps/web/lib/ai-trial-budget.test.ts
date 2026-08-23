import { describe, expect, it, vi } from 'vitest';
import { actualAiCostRub, estimateAiMaxCostRub, reserveAiOperation } from './ai-trial-budget';

describe('Alice AI trial cost guard', () => {
  const rates = { inputRubPer1kTokens: 0.5, outputRubPer1kTokens: 1.2 };
  it('reserves a conservative one-character-per-token maximum', () => {
    expect(estimateAiMaxCostRub({ inputCharacters: 1000, maxOutputTokens: 800 }, rates)).toBeCloseTo(1.588, 6);
  });
  it('calculates actual cost from provider usage separately from the reservation', () => {
    expect(actualAiCostRub(500, 200, rates)).toBeCloseTo(0.49, 6);
  });

  it('refuses an unauthorized cap before touching D1', async () => {
    const db = { prepare: vi.fn() } as unknown as D1Database;
    await expect(reserveAiOperation({ db, operationId: 'op-budget', userId: 'qa', kind: 'assembly', provider: 'yandex-ai-studio', model: 'aliceai-llm', sourceIds: ['source-1'], qaNonpersonalVerified: true, maxCostRub: 2, workingCapRub: 61, absoluteCapRub: 100 })).rejects.toThrow('approved limits');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('uses an atomic insert guard that counts actual completed spend plus active reservations', async () => {
    const sql: string[] = [];
    const db = { prepare: vi.fn((statement: string) => {
      sql.push(statement);
      if (statement.startsWith('INSERT')) return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
      if (statement.includes('FROM ai_operations WHERE operation_id')) return { bind: () => ({ first: async () => ({ operation_id: 'op-atomic', status: 'reserved' }) }) };
      return { first: async () => ({ total: 2_000_000 }) };
    }) } as unknown as D1Database;
    const result = await reserveAiOperation({ db, operationId: 'op-atomic', userId: 'qa', kind: 'assembly', provider: 'yandex-ai-studio', model: 'aliceai-llm', sourceIds: ['source-1'], qaNonpersonalVerified: true, maxCostRub: 2, workingCapRub: 60, absoluteCapRub: 100 });
    expect(result).toMatchObject({ claimed: true, reservedTotalRub: 2 });
    expect(sql[0]).toContain('INSERT OR IGNORE');
    expect(sql[0]).toContain("status IN ('completed', 'failed')");
    expect(sql[0]).toContain("status IN ('reserved', 'uncertain')");
  });
});
