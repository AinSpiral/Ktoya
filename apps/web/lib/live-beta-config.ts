import { LIVE_BETA_CAP_RUB, type LiveBetaRates } from './live-beta-budget';

export const LIVE_BETA_FOLDER_ID = 'b1gkl7lo86seu967m35j';
export const LIVE_BETA_MODEL = 'speech-realtime-260528';
export const LIVE_BETA_SCOPE = 'yc.ai.foundationModels.execute';
export const LIVE_BETA_CONSENT_VERSION = 'external-yandex-v1';

export interface LiveBetaConfig extends LiveBetaRates {
  apiKey: string;
  folderId: typeof LIVE_BETA_FOLDER_ID;
  model: typeof LIVE_BETA_MODEL;
  keyId: string;
  keyExpiresAt: string;
  capRub: typeof LIVE_BETA_CAP_RUB;
  verifiedAt: string;
}

function exactPositive(value: string | undefined, expected: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === expected ? parsed : null;
}

function recent(value: string | undefined, now: Date) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) && parsed <= now.getTime() && now.getTime() - parsed <= 24 * 60 * 60 * 1000 ? parsed : null;
}

/** Fail closed unless the TEST-only deployment matches the reviewed IAM and tariff contract exactly. */
export function readLiveBetaConfig(env: Cloudflare.Env, now = new Date()): LiveBetaConfig | null {
  if (env.KTOYA_LIVE_BETA_ENABLED !== 'true' || !env.KTOYA_LIVE_API_KEY || !env.KTOYA_LIVE_KEY_ID) return null;
  if (env.KTOYA_LIVE_FOLDER_ID !== LIVE_BETA_FOLDER_ID || env.KTOYA_LIVE_MODEL !== LIVE_BETA_MODEL || env.KTOYA_LIVE_KEY_SCOPES !== LIVE_BETA_SCOPE) return null;
  const iam = recent(env.KTOYA_LIVE_IAM_VERIFIED_AT, now);
  const tariff = recent(env.KTOYA_LIVE_TARIFF_VERIFIED_AT, now);
  const billing = recent(env.KTOYA_LIVE_BILLING_VERIFIED_AT, now);
  const expiresAt = Date.parse(env.KTOYA_LIVE_KEY_EXPIRES_AT ?? '');
  const inputAudioRubPerSecond = exactPositive(env.KTOYA_LIVE_INPUT_AUDIO_RUB_PER_SECOND, 0.0264);
  const outputAudioRubPerSecond = exactPositive(env.KTOYA_LIVE_OUTPUT_AUDIO_RUB_PER_SECOND, 0.0203);
  const inputTextRubPer1kTokens = exactPositive(env.KTOYA_LIVE_INPUT_TEXT_RUB_PER_1K_TOKENS, 0.1);
  const outputTextRubPer1kTokens = exactPositive(env.KTOYA_LIVE_OUTPUT_TEXT_RUB_PER_1K_TOKENS, 0.2);
  const capRub = exactPositive(env.KTOYA_LIVE_CAP_RUB, LIVE_BETA_CAP_RUB);
  if (!iam || !tariff || !billing || !inputAudioRubPerSecond || !outputAudioRubPerSecond || !inputTextRubPer1kTokens || !outputTextRubPer1kTokens || !capRub) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime() || expiresAt - now.getTime() > 14 * 24 * 60 * 60 * 1000) return null;
  return {
    apiKey: env.KTOYA_LIVE_API_KEY,
    folderId: LIVE_BETA_FOLDER_ID,
    model: LIVE_BETA_MODEL,
    keyId: env.KTOYA_LIVE_KEY_ID,
    keyExpiresAt: new Date(expiresAt).toISOString(),
    capRub: LIVE_BETA_CAP_RUB,
    verifiedAt: new Date(Math.min(iam, tariff, billing)).toISOString(),
    inputAudioRubPerSecond,
    outputAudioRubPerSecond,
    inputTextRubPer1kTokens,
    outputTextRubPer1kTokens,
  };
}
