import { describe, expect, it } from 'vitest';
import { readSpeechKitTrialConfig } from './voice-trial-config';

function trialEnv(overrides: Partial<Cloudflare.Env> = {}) {
  return {
    KTOYA_SPEECHKIT_TRIAL_ENABLED: 'true',
    YANDEX_SPEECHKIT_API_KEY: 'test-secret-never-log',
    KTOYA_SPEECHKIT_TARIFF_VERIFIED_AT: '2026-08-23T10:00:00.000Z',
    KTOYA_SPEECHKIT_KEY_EXPIRES_AT: '2026-08-30T10:00:00.000Z',
    KTOYA_SPEECHKIT_KEY_SCOPES: 'yc.ai.speechkitStt.execute,yc.ai.speechkitTts.execute',
    KTOYA_SPEECHKIT_IAM_VERIFIED_AT: '2026-08-23T10:00:00.000Z',
    KTOYA_SPEECHKIT_STT_RUB_PER_SECOND: '0.0101',
    KTOYA_SPEECHKIT_TTS_RUB_PER_UNIT: '0.1626',
    KTOYA_SPEECHKIT_TRIAL_CAP_RUB: '25',
    ...overrides,
  } as Cloudflare.Env;
}

describe('SpeechKit protected trial configuration', () => {
  it('requires a same-day tariff verification, finite key lifetime and sub-500 cap', () => {
    const now = new Date('2026-08-23T12:00:00.000Z');
    expect(readSpeechKitTrialConfig(trialEnv(), now)).toMatchObject({ capRub: 25, sttRubPerSecond: 0.0101, ttsRubPer250Chars: 0.1626, defaultTtsVoice: 'marina' });
    expect(readSpeechKitTrialConfig(trialEnv({ KTOYA_SPEECHKIT_TARIFF_VERIFIED_AT: '2026-08-20T10:00:00.000Z' }), now)).toBeNull();
    expect(readSpeechKitTrialConfig(trialEnv({ KTOYA_SPEECHKIT_KEY_EXPIRES_AT: '2026-08-22T10:00:00.000Z' }), now)).toBeNull();
    expect(readSpeechKitTrialConfig(trialEnv({ KTOYA_SPEECHKIT_KEY_EXPIRES_AT: '2026-09-30T10:00:00.000Z' }), now)).toBeNull();
    expect(readSpeechKitTrialConfig(trialEnv({ KTOYA_SPEECHKIT_KEY_SCOPES: 'yc.ai.speechkitStt.execute' }), now)).toBeNull();
    expect(readSpeechKitTrialConfig(trialEnv({ KTOYA_SPEECHKIT_TRIAL_CAP_RUB: '500.01' }), now)).toBeNull();
    expect(readSpeechKitTrialConfig(trialEnv({ KTOYA_SPEECHKIT_DEFAULT_TTS_VOICE: 'unreviewed-voice' }), now)).toBeNull();
  });

  it('cannot be enabled by a secret alone or by broad implicit defaults', () => {
    const now = new Date('2026-08-23T12:00:00.000Z');
    expect(readSpeechKitTrialConfig({ YANDEX_SPEECHKIT_API_KEY: 'secret' } as Cloudflare.Env, now)).toBeNull();
    expect(readSpeechKitTrialConfig(trialEnv({ KTOYA_SPEECHKIT_STT_RUB_PER_SECOND: undefined }), now)).toBeNull();
  });
});
