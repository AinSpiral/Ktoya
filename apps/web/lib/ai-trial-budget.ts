export const AI_TRIAL_WORKING_CAP_RUB = 60;
export const AI_TRIAL_ABSOLUTE_CAP_RUB = 100;

export type AIOperationKind = 'interview-next' | 'assembly' | 'rephrase' | 'patch';

export interface AITrialRates {
  inputRubPer1kTokens: number;
  outputRubPer1kTokens: number;
}

export function estimateAiMaxCostRub(input: { inputCharacters: number; maxOutputTokens: number }, rates: AITrialRates) {
  if (!Number.isInteger(input.inputCharacters) || input.inputCharacters <= 0 || !Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0) throw new Error('Bounded input and output are required before an AI reservation.');
  // One Unicode character per token is deliberately conservative for Russian.
  const inputTokens = input.inputCharacters + 256;
  return inputTokens / 1000 * rates.inputRubPer1kTokens + input.maxOutputTokens / 1000 * rates.outputRubPer1kTokens;
}

export function actualAiCostRub(inputTokens: number, outputTokens: number, rates: AITrialRates) {
  if (inputTokens < 0 || outputTokens < 0) throw new Error('Token usage cannot be negative.');
  return inputTokens / 1000 * rates.inputRubPer1kTokens + outputTokens / 1000 * rates.outputRubPer1kTokens;
}

function microrub(rub: number) { return Math.ceil(rub * 1_000_000); }

export type AIOperationRow = {
  operation_id: string;
  user_id: string;
  kind: AIOperationKind;
  provider: string;
  model: string;
  story_id: string | null;
  capture_draft_id: string | null;
  base_revision_id: string | null;
  source_ids_json: string;
  qa_nonpersonal: 1;
  max_cost_microrub: number;
  actual_cost_microrub: number | null;
  status: 'reserved' | 'completed' | 'uncertain' | 'failed';
  input_tokens: number | null;
  output_tokens: number | null;
  result_preview_id: string | null;
  created_revision_id: string | null;
  error_code: string | null;
};

export async function reserveAiOperation(input: {
  db: D1Database; operationId: string; userId: string; kind: AIOperationKind; provider: string; model: string;
  storyId?: string; captureDraftId?: string; baseRevisionId?: string; sourceIds: string[]; qaNonpersonalVerified: true;
  maxCostRub: number; workingCapRub: number; absoluteCapRub: number;
}) {
  if (input.qaNonpersonalVerified !== true) throw new Error('Only verified nonpersonal QA material may reserve AI trial budget.');
  if (input.absoluteCapRub > AI_TRIAL_ABSOLUTE_CAP_RUB || input.workingCapRub > input.absoluteCapRub || input.workingCapRub > AI_TRIAL_WORKING_CAP_RUB) throw new Error('AI trial caps exceed the Author-approved limits.');
  const now = new Date().toISOString();
  const cost = microrub(input.maxCostRub);
  const cap = microrub(input.workingCapRub);
  const result = await input.db.prepare(`INSERT OR IGNORE INTO ai_operations
    (operation_id, user_id, kind, provider, model, story_id, capture_draft_id, base_revision_id, source_ids_json, qa_nonpersonal, max_cost_microrub, status, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'reserved', ?, ?
    WHERE COALESCE((SELECT SUM(CASE
      WHEN status IN ('completed', 'failed') THEN COALESCE(actual_cost_microrub, max_cost_microrub)
      WHEN status IN ('reserved', 'uncertain') THEN max_cost_microrub
      ELSE 0 END) FROM ai_operations WHERE provider != 'deterministic'), 0) + ? <= ?`)
    .bind(input.operationId, input.userId, input.kind, input.provider, input.model, input.storyId ?? null, input.captureDraftId ?? null, input.baseRevisionId ?? null, JSON.stringify(input.sourceIds), cost, now, now, cost, cap).run();
  const operation = await findAiOperation(input.db, input.operationId, input.userId);
  const total = await input.db.prepare(`SELECT COALESCE(SUM(CASE
    WHEN status IN ('completed', 'failed') THEN COALESCE(actual_cost_microrub, max_cost_microrub)
    WHEN status IN ('reserved', 'uncertain') THEN max_cost_microrub
    ELSE 0 END), 0) AS total FROM ai_operations WHERE provider != 'deterministic'`).first<{ total: number }>();
  return { claimed: result.meta.changes === 1, operation, reservedTotalRub: (total?.total ?? 0) / 1_000_000 };
}

export async function findAiOperation(db: D1Database, operationId: string, userId: string) {
  return db.prepare(`SELECT operation_id, user_id, kind, provider, model, story_id, capture_draft_id, base_revision_id, source_ids_json, qa_nonpersonal,
    max_cost_microrub, actual_cost_microrub, status, input_tokens, output_tokens, result_preview_id, created_revision_id, error_code
    FROM ai_operations WHERE operation_id = ? AND user_id = ?`).bind(operationId, userId).first<AIOperationRow>();
}

export async function requireReservedAiOperation(input: { db: D1Database; operationId: string; userId: string; kind: AIOperationKind }) {
  const row = await findAiOperation(input.db, input.operationId, input.userId);
  if (!row || row.status !== 'reserved' || row.kind !== input.kind || row.qa_nonpersonal !== 1) throw new Error('No matching reserved nonpersonal AI operation.');
  return row;
}

export async function completeAiOperation(input: { db: D1Database; operationId: string; inputTokens: number; outputTokens: number; actualCostRub: number; previewId: string }) {
  await input.db.prepare(`UPDATE ai_operations SET status = 'completed', input_tokens = ?, output_tokens = ?, actual_cost_microrub = ?, result_preview_id = ?, updated_at = ? WHERE operation_id = ? AND status = 'reserved'`)
    .bind(input.inputTokens, input.outputTokens, microrub(input.actualCostRub), input.previewId, new Date().toISOString(), input.operationId).run();
}

export async function markAiOperationUncertain(db: D1Database, operationId: string, errorCode = 'provider_outcome_uncertain') {
  await db.prepare(`UPDATE ai_operations SET status = 'uncertain', error_code = ?, updated_at = ? WHERE operation_id = ? AND status = 'reserved'`)
    .bind(errorCode, new Date().toISOString(), operationId).run();
}

export async function failAiOperation(input: { db: D1Database; operationId: string; errorCode: string; inputTokens?: number; outputTokens?: number; actualCostRub?: number }) {
  await input.db.prepare(`UPDATE ai_operations SET status = 'failed', error_code = ?, input_tokens = ?, output_tokens = ?, actual_cost_microrub = ?, updated_at = ? WHERE operation_id = ? AND status = 'reserved'`)
    .bind(input.errorCode, input.inputTokens ?? null, input.outputTokens ?? null, input.actualCostRub == null ? null : microrub(input.actualCostRub), new Date().toISOString(), input.operationId).run();
}

export async function linkAiOperationRevision(db: D1Database, operationId: string, revisionId: string) {
  await db.prepare(`UPDATE ai_operations SET created_revision_id = ?, updated_at = ? WHERE operation_id = ? AND status = 'completed' AND created_revision_id IS NULL`)
    .bind(revisionId, new Date().toISOString(), operationId).run();
}
