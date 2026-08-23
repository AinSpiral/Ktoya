export const ABSOLUTE_TRIAL_CAP_RUB = 500;
export const PUBLIC_STT_RUB_PER_SECOND = 0.0101;
export const PUBLIC_TTS_RUB_PER_250_CHARS = 0.1626;

export interface VoiceTrialRates {
  sttRubPerSecond: number;
  ttsRubPer250Chars: number;
}

export function estimateAsyncSttRub(durationMs: number, rate: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Audio duration is required before a billable STT request.');
  return Math.max(15, Math.ceil(durationMs / 1000)) * rate;
}

export function estimateTtsRub(text: string, rate: number) {
  const characters = text.length;
  if (!characters) throw new Error('Text is required before a billable TTS request.');
  return Math.max(1, Math.ceil(characters / 250)) * rate;
}

export function rubToMicrorub(rub: number) {
  if (!Number.isFinite(rub) || rub < 0) throw new Error('Invalid trial cost.');
  return Math.ceil(rub * 1_000_000);
}

export interface VoiceTrialPlan {
  sttDurationsSeconds: number[];
  ttsCharactersPerVoice: number;
  ttsVoiceCount: number;
  retryMultiplier: number;
}

export function estimateTrialPlanRub(plan: VoiceTrialPlan, rates: VoiceTrialRates) {
  const stt = plan.sttDurationsSeconds.reduce((sum, seconds) => sum + estimateAsyncSttRub(seconds * 1000, rates.sttRubPerSecond), 0);
  const tts = plan.ttsVoiceCount * estimateTtsRub('x'.repeat(plan.ttsCharactersPerVoice), rates.ttsRubPer250Chars);
  return (stt + tts) * plan.retryMultiplier;
}

type TrialOperationRow = {
  operation_id: string;
  max_cost_microrub: number;
  status: 'reserved' | 'submitted' | 'completed' | 'uncertain';
  external_job_id: string | null;
  user_id: string;
  kind: 'stt' | 'tts';
  source_id: string;
  qa_nonpersonal: 1;
};

/**
 * One SQL statement both checks the total and inserts a unique reservation.
 * Existing/uncertain operations are never automatically charged a second time.
 */
export async function reserveTrialOperation(input: {
  db: D1Database;
  operationId: string;
  userId: string;
  kind: 'stt' | 'tts';
  sourceId: string;
  qaNonpersonalVerified: true;
  maxCostRub: number;
  capRub: number;
}): Promise<{ claimed: boolean; operation: TrialOperationRow | null; reservedTotalRub: number }> {
  if (input.qaNonpersonalVerified !== true) throw new Error('Only verified nonpersonal QA material may reserve trial budget.');
  if (input.capRub > ABSOLUTE_TRIAL_CAP_RUB) throw new Error('Trial cap exceeds the Author-approved absolute maximum.');
  const cost = rubToMicrorub(input.maxCostRub);
  const cap = rubToMicrorub(input.capRub);
  const now = new Date().toISOString();
  const result = await input.db.prepare(`INSERT OR IGNORE INTO voice_trial_operations
    (operation_id, user_id, kind, source_id, qa_nonpersonal, max_cost_microrub, status, created_at, updated_at)
    SELECT ?, ?, ?, ?, 1, ?, 'reserved', ?, ?
    WHERE COALESCE((SELECT SUM(max_cost_microrub) FROM voice_trial_operations), 0) + ? <= ?`)
    .bind(input.operationId, input.userId, input.kind, input.sourceId, cost, now, now, cost, cap).run();
  const operation = await input.db.prepare(`SELECT operation_id, user_id, kind, source_id, qa_nonpersonal, max_cost_microrub, status, external_job_id
    FROM voice_trial_operations WHERE operation_id = ? AND user_id = ?`).bind(input.operationId, input.userId).first<TrialOperationRow>();
  const total = await input.db.prepare('SELECT COALESCE(SUM(max_cost_microrub), 0) AS total FROM voice_trial_operations').first<{ total: number }>();
  return { claimed: result.meta.changes === 1, operation, reservedTotalRub: (total?.total ?? 0) / 1_000_000 };
}

export async function requireReservedTrialOperation(input: { db: D1Database; operationId: string; userId: string; kind: 'stt' | 'tts'; sourceId: string }) {
  const row = await input.db.prepare(`SELECT operation_id, user_id, kind, source_id, qa_nonpersonal, max_cost_microrub, status, external_job_id
    FROM voice_trial_operations WHERE operation_id = ? AND user_id = ? AND kind = ? AND source_id = ? AND qa_nonpersonal = 1`)
    .bind(input.operationId, input.userId, input.kind, input.sourceId).first<TrialOperationRow>();
  if (!row || row.status !== 'reserved' || row.user_id !== input.userId || row.kind !== input.kind || row.source_id !== input.sourceId || row.qa_nonpersonal !== 1) throw new Error('No matching reserved QA trial operation.');
  return row;
}

export async function requireSubmittedTrialOperation(input: { db: D1Database; operationId: string; userId: string; kind: 'stt' | 'tts'; sourceId: string; externalJobId: string }) {
  const row = await input.db.prepare(`SELECT operation_id, user_id, kind, source_id, qa_nonpersonal, max_cost_microrub, status, external_job_id
    FROM voice_trial_operations WHERE operation_id = ? AND user_id = ? AND kind = ? AND source_id = ? AND qa_nonpersonal = 1 AND external_job_id = ?`)
    .bind(input.operationId, input.userId, input.kind, input.sourceId, input.externalJobId).first<TrialOperationRow>();
  if (!row || row.status !== 'submitted' || row.external_job_id !== input.externalJobId || row.user_id !== input.userId || row.kind !== input.kind || row.source_id !== input.sourceId || row.qa_nonpersonal !== 1) throw new Error('No matching submitted QA trial operation.');
  return row;
}

export async function markTrialOperation(input: {
  db: D1Database;
  operationId: string;
  status: 'submitted' | 'completed' | 'uncertain';
  externalJobId?: string;
}) {
  await input.db.prepare(`UPDATE voice_trial_operations SET status = ?, external_job_id = COALESCE(?, external_job_id), updated_at = ? WHERE operation_id = ?`)
    .bind(input.status, input.externalJobId ?? null, new Date().toISOString(), input.operationId).run();
}
