export const LIVE_BETA_CAP_RUB = 100 as const;
export const LIVE_BETA_MAX_AUDIO_MS = 180_000;
export const LIVE_BETA_MAX_OUTPUT_AUDIO_MS = 30_000;

export type LiveBetaOperationKind = 'voice-turn' | 'interview-next' | 'assembly' | 'rephrase' | 'patch';
export type LiveBetaOperationStatus = 'reserved' | 'completed' | 'failed' | 'uncertain' | 'cancelled';

export interface LiveBetaRates {
  inputAudioRubPerSecond: number;
  outputAudioRubPerSecond: number;
  inputTextRubPer1kTokens: number;
  outputTextRubPer1kTokens: number;
}

export interface LiveBetaUsage {
  inputAudioMs?: number;
  outputAudioMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export function liveBetaCostRub(usage: LiveBetaUsage, rates: LiveBetaRates) {
  return (usage.inputAudioMs ?? 0) / 1000 * rates.inputAudioRubPerSecond
    + (usage.outputAudioMs ?? 0) / 1000 * rates.outputAudioRubPerSecond
    + (usage.inputTokens ?? 0) / 1000 * rates.inputTextRubPer1kTokens
    + (usage.outputTokens ?? 0) / 1000 * rates.outputTextRubPer1kTokens;
}

export function estimateVoiceTurnMaxRub(inputAudioMs: number, rates: LiveBetaRates) {
  if (!Number.isInteger(inputAudioMs) || inputAudioMs <= 0 || inputAudioMs > LIVE_BETA_MAX_AUDIO_MS) throw new Error('Voice turn duration is outside the closed Beta limit.');
  return liveBetaCostRub({ inputAudioMs, outputAudioMs: LIVE_BETA_MAX_OUTPUT_AUDIO_MS, inputTokens: 4_000, outputTokens: 800 }, rates);
}

export function estimateTextOperationMaxRub(inputCharacters: number, maxOutputTokens: number, rates: LiveBetaRates) {
  if (!Number.isInteger(inputCharacters) || inputCharacters <= 0 || inputCharacters > 80_000) throw new Error('AI input is outside the closed Beta limit.');
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 3_000) throw new Error('AI output is outside the closed Beta limit.');
  // One Unicode character per token plus a fixed system-prompt allowance is deliberately conservative for Russian.
  return liveBetaCostRub({ inputTokens: inputCharacters + 4_000, outputTokens: maxOutputTokens }, rates);
}

const microrub = (rub: number) => Math.ceil(rub * 1_000_000);

export async function reserveLiveBetaOperation(input: {
  db: D1Database;
  operationId: string;
  userId: string;
  kind: LiveBetaOperationKind;
  model: string;
  maxCostRub: number;
  sourceId?: string;
  consentVersion: string;
}) {
  if (!Number.isFinite(input.maxCostRub) || input.maxCostRub <= 0 || input.maxCostRub > LIVE_BETA_CAP_RUB) throw new Error('Invalid closed Beta reservation.');
  const now = new Date().toISOString();
  const cost = microrub(input.maxCostRub);
  const cap = microrub(LIVE_BETA_CAP_RUB);
  const result = await input.db.prepare(`INSERT OR IGNORE INTO live_beta_operations
    (operation_id, user_id, kind, provider, model, source_id, consent_version, max_cost_microrub, status, provider_calls, user_turns, retries, reconnects, created_at, updated_at)
    SELECT ?, ?, ?, 'yandex-ai-studio-realtime', ?, ?, ?, ?, 'reserved', 0, ?, 0, 0, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM live_beta_operations
      WHERE user_id = ? AND kind = ? AND source_id IS ? AND status IN ('reserved', 'uncertain'))
    AND COALESCE((SELECT SUM(CASE
      WHEN status = 'completed' THEN COALESCE(actual_cost_microrub, max_cost_microrub)
      WHEN status IN ('failed', 'reserved', 'uncertain') THEN COALESCE(actual_cost_microrub, max_cost_microrub)
      ELSE 0 END) FROM live_beta_operations), 0) + ? <= ?`)
    .bind(input.operationId, input.userId, input.kind, input.model, input.sourceId ?? null, input.consentVersion, cost, 1, now, now, input.userId, input.kind, input.sourceId ?? null, cost, cap).run();
  const existing = await findLiveBetaOperation(input.db, input.operationId);
  const unresolved = result.meta.changes === 1 ? null : await input.db.prepare(`SELECT operation_id, status FROM live_beta_operations
    WHERE user_id = ? AND kind = ? AND source_id IS ? AND status IN ('reserved', 'uncertain') ORDER BY created_at DESC LIMIT 1`)
    .bind(input.userId, input.kind, input.sourceId ?? null).first<{ operation_id: string; status: LiveBetaOperationStatus }>();
  const budget = await liveBetaBudgetStatus(input.db);
  return { claimed: result.meta.changes === 1, operation: existing, budget, blockedByUnresolved: Boolean(unresolved), unresolved };
}

export async function findLiveBetaOperation(db: D1Database, operationId: string) {
  return db.prepare(`SELECT operation_id, user_id, kind, provider, model, status, max_cost_microrub, actual_cost_microrub,
    input_audio_ms, output_audio_ms, input_tokens, output_tokens, provider_session_id, provider_calls, user_turns, retries, reconnects, error_code
    FROM live_beta_operations WHERE operation_id = ?`).bind(operationId).first<{
      operation_id: string; user_id: string; kind: LiveBetaOperationKind; provider: string; model: string; status: LiveBetaOperationStatus;
      max_cost_microrub: number; actual_cost_microrub: number | null; input_audio_ms: number | null; output_audio_ms: number | null;
      input_tokens: number | null; output_tokens: number | null; provider_session_id: string | null; provider_calls: number;
      user_turns: number; retries: number; reconnects: number; error_code: string | null;
    }>();
}

export async function requireReservedLiveBetaOperation(db: D1Database, operationId: string, userId: string, kind: LiveBetaOperationKind) {
  const row = await findLiveBetaOperation(db, operationId);
  if (!row || row.user_id !== userId || row.kind !== kind || row.status !== 'reserved') throw new Error('No matching closed Beta reservation.');
  return row;
}

export async function noteLiveBetaProviderCall(db: D1Database, operationId: string) {
  await db.prepare(`UPDATE live_beta_operations SET provider_calls = provider_calls + 1, updated_at = ?
    WHERE operation_id = ? AND status = 'reserved' AND provider_calls = 0`).bind(new Date().toISOString(), operationId).run();
}

export async function completeLiveBetaOperation(input: { db: D1Database; operationId: string; actualCostRub: number; usage: LiveBetaUsage; providerSessionId?: string }) {
  await input.db.prepare(`UPDATE live_beta_operations SET status = 'completed', actual_cost_microrub = ?, input_audio_ms = ?, output_audio_ms = ?, input_tokens = ?, output_tokens = ?, provider_session_id = ?, updated_at = ?
    WHERE operation_id = ? AND status = 'reserved'`)
    .bind(microrub(input.actualCostRub), input.usage.inputAudioMs ?? 0, input.usage.outputAudioMs ?? 0, input.usage.inputTokens ?? 0, input.usage.outputTokens ?? 0, input.providerSessionId ?? null, new Date().toISOString(), input.operationId).run();
}

export async function failLiveBetaOperation(input: { db: D1Database; operationId: string; errorCode: string; uncertain: boolean; actualCostRub?: number; usage?: LiveBetaUsage; providerSessionId?: string }) {
  await input.db.prepare(`UPDATE live_beta_operations SET status = ?, error_code = ?, actual_cost_microrub = ?, input_audio_ms = ?, output_audio_ms = ?, input_tokens = ?, output_tokens = ?, provider_session_id = ?, updated_at = ?
    WHERE operation_id = ? AND status = 'reserved'`)
    .bind(input.uncertain ? 'uncertain' : 'failed', input.errorCode, input.actualCostRub == null ? null : microrub(input.actualCostRub), input.usage?.inputAudioMs ?? null, input.usage?.outputAudioMs ?? null, input.usage?.inputTokens ?? null, input.usage?.outputTokens ?? null, input.providerSessionId ?? null, new Date().toISOString(), input.operationId).run();
}

export async function liveBetaBudgetStatus(db: D1Database) {
  const row = await db.prepare(`SELECT
      COUNT(*) AS sessions,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successful_sessions,
      COALESCE(SUM(user_turns), 0) AS user_turns,
      COALESCE(SUM(input_audio_ms), 0) AS input_audio_ms,
      COALESCE(SUM(output_audio_ms), 0) AS output_audio_ms,
      COALESCE(SUM(provider_calls), 0) AS provider_calls,
      COALESCE(SUM(retries), 0) AS retries,
      COALESCE(SUM(reconnects), 0) AS reconnects,
      COALESCE(SUM(CASE WHEN status IN ('reserved','uncertain') THEN max_cost_microrub ELSE 0 END), 0) AS reserved_microrub,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(actual_cost_microrub, max_cost_microrub) WHEN status IN ('failed','reserved','uncertain') THEN COALESCE(actual_cost_microrub, max_cost_microrub) ELSE 0 END), 0) AS committed_microrub
    FROM live_beta_operations`).first<Record<string, number | null>>();
  const committedRub = Number(row?.committed_microrub ?? 0) / 1_000_000;
  const inputMinutes = Number(row?.input_audio_ms ?? 0) / 60_000;
  return {
    capRub: LIVE_BETA_CAP_RUB,
    committedRub,
    remainingRub: Math.max(0, LIVE_BETA_CAP_RUB - committedRub),
    reservedRub: Number(row?.reserved_microrub ?? 0) / 1_000_000,
    sessions: Number(row?.sessions ?? 0),
    successfulSessions: Number(row?.successful_sessions ?? 0),
    userTurns: Number(row?.user_turns ?? 0),
    inputAudioSeconds: Number(row?.input_audio_ms ?? 0) / 1000,
    outputAudioSeconds: Number(row?.output_audio_ms ?? 0) / 1000,
    providerCalls: Number(row?.provider_calls ?? 0),
    retries: Number(row?.retries ?? 0),
    reconnects: Number(row?.reconnects ?? 0),
    rubPerSession: Number(row?.successful_sessions ?? 0) > 0 ? committedRub / Number(row?.successful_sessions) : 0,
    rubPerTurn: Number(row?.user_turns ?? 0) > 0 ? committedRub / Number(row?.user_turns) : 0,
    rubPerInputMinute: inputMinutes > 0 ? committedRub / inputMinutes : 0,
  };
}
