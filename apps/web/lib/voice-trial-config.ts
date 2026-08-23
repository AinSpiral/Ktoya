import { ABSOLUTE_TRIAL_CAP_RUB, type VoiceTrialRates } from './voice-trial-budget';
import { resolveSpeechKitDefaultTtsVoice, type SpeechKitTtsVoice } from './speechkit-voice-selection';

export interface SpeechKitTrialConfig extends VoiceTrialRates {
  enabled: true;
  apiKey: string;
  capRub: number;
  tariffVerifiedAt: string;
  keyExpiresAt: string;
  defaultTtsVoice: SpeechKitTtsVoice;
}

const REQUIRED_SCOPES = ['yc.ai.speechkitStt.execute', 'yc.ai.speechkitTts.execute'] as const;

function positiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** No secret is ever returned by capabilities or included in an error. */
export function readSpeechKitTrialConfig(env: Cloudflare.Env, now = new Date()): SpeechKitTrialConfig | null {
  if (env.KTOYA_SPEECHKIT_TRIAL_ENABLED !== 'true' || !env.YANDEX_SPEECHKIT_API_KEY) return null;
  const sttRubPerSecond = positiveNumber(env.KTOYA_SPEECHKIT_STT_RUB_PER_SECOND);
  const ttsRubPer250Chars = positiveNumber(env.KTOYA_SPEECHKIT_TTS_RUB_PER_UNIT);
  const capRub = positiveNumber(env.KTOYA_SPEECHKIT_TRIAL_CAP_RUB);
  const verifiedAt = Date.parse(env.KTOYA_SPEECHKIT_TARIFF_VERIFIED_AT ?? '');
  const iamVerifiedAt = Date.parse(env.KTOYA_SPEECHKIT_IAM_VERIFIED_AT ?? '');
  const expiresAt = Date.parse(env.KTOYA_SPEECHKIT_KEY_EXPIRES_AT ?? '');
  const defaultTtsVoice = resolveSpeechKitDefaultTtsVoice(env.KTOYA_SPEECHKIT_DEFAULT_TTS_VOICE);
  const scopes = (env.KTOYA_SPEECHKIT_KEY_SCOPES ?? '').split(',').map((item) => item.trim()).filter(Boolean).sort();
  if (!sttRubPerSecond || !ttsRubPer250Chars || !capRub || capRub > ABSOLUTE_TRIAL_CAP_RUB || !defaultTtsVoice) return null;
  // A paid request requires a same-day account-tariff readback and an unexpired trial key.
  if (!Number.isFinite(verifiedAt) || now.getTime() - verifiedAt > 24 * 60 * 60 * 1000 || verifiedAt > now.getTime()) return null;
  if (!Number.isFinite(iamVerifiedAt) || now.getTime() - iamVerifiedAt > 24 * 60 * 60 * 1000 || iamVerifiedAt > now.getTime()) return null;
  if (scopes.join(',') !== [...REQUIRED_SCOPES].sort().join(',')) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime() || expiresAt - now.getTime() > 14 * 24 * 60 * 60 * 1000) return null;
  return {
    enabled: true,
    apiKey: env.YANDEX_SPEECHKIT_API_KEY,
    capRub,
    tariffVerifiedAt: new Date(verifiedAt).toISOString(),
    keyExpiresAt: new Date(expiresAt).toISOString(),
    sttRubPerSecond,
    ttsRubPer250Chars,
    defaultTtsVoice,
  };
}
