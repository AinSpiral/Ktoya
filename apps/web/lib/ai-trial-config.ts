import { AI_TRIAL_ABSOLUTE_CAP_RUB, AI_TRIAL_WORKING_CAP_RUB, type AITrialRates } from './ai-trial-budget';

const REQUIRED_SCOPE = 'yc.ai.foundationModels.execute';
const TRIAL_FOLDER_ID = 'b1gkl7lo86seu967m35j';
const TRIAL_MODEL = 'aliceai-llm';

export interface AliceTrialConfig extends AITrialRates {
  apiKey: string;
  qaUserId: string;
  folderId: string;
  model: typeof TRIAL_MODEL;
  workingCapRub: number;
  absoluteCapRub: number;
  keyExpiresAt: string;
  tariffVerifiedAt: string;
}

function positive(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fresh(value: string | undefined, now: Date) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) && parsed <= now.getTime() && now.getTime() - parsed <= 24 * 60 * 60 * 1000 ? parsed : null;
}

/** Returns null rather than partially enabling a paid provider. */
export function readAliceTrialConfig(env: Cloudflare.Env, now = new Date()): AliceTrialConfig | null {
  const qaUserId = env.KTOYA_AI_QA_USER_ID?.trim();
  if (env.KTOYA_AI_TRIAL_ENABLED !== 'true' || !env.KTOYA_AI_API_KEY || !qaUserId || qaUserId.length > 200 || env.KTOYA_AI_FOLDER_ID !== TRIAL_FOLDER_ID || env.KTOYA_AI_MODEL !== TRIAL_MODEL) return null;
  if (env.KTOYA_AI_BILLING_ACTIVE !== 'true' || env.KTOYA_AI_KEY_SCOPES !== REQUIRED_SCOPE) return null;
  const tariffVerifiedAt = fresh(env.KTOYA_AI_TARIFF_VERIFIED_AT, now);
  const billingVerifiedAt = fresh(env.KTOYA_AI_BILLING_VERIFIED_AT, now);
  const iamVerifiedAt = fresh(env.KTOYA_AI_IAM_VERIFIED_AT, now);
  const expiresAt = Date.parse(env.KTOYA_AI_KEY_EXPIRES_AT ?? '');
  const inputRubPer1kTokens = positive(env.KTOYA_AI_INPUT_RUB_PER_1K_TOKENS);
  const outputRubPer1kTokens = positive(env.KTOYA_AI_OUTPUT_RUB_PER_1K_TOKENS);
  const workingCapRub = positive(env.KTOYA_AI_WORKING_CAP_RUB);
  const absoluteCapRub = positive(env.KTOYA_AI_ABSOLUTE_CAP_RUB);
  if (!tariffVerifiedAt || !billingVerifiedAt || !iamVerifiedAt || !inputRubPer1kTokens || !outputRubPer1kTokens || !workingCapRub || !absoluteCapRub) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime() || expiresAt - now.getTime() > 14 * 24 * 60 * 60 * 1000) return null;
  if (workingCapRub > absoluteCapRub || workingCapRub > AI_TRIAL_WORKING_CAP_RUB || absoluteCapRub > AI_TRIAL_ABSOLUTE_CAP_RUB) return null;
  return { apiKey: env.KTOYA_AI_API_KEY, qaUserId, folderId: TRIAL_FOLDER_ID, model: TRIAL_MODEL, workingCapRub, absoluteCapRub, keyExpiresAt: new Date(expiresAt).toISOString(), tariffVerifiedAt: new Date(tariffVerifiedAt).toISOString(), inputRubPer1kTokens, outputRubPer1kTokens };
}
