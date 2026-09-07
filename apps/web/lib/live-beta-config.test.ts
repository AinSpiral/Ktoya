import { describe, expect, it } from 'vitest';
import { LIVE_BETA_CAP_RUB, estimateTextOperationMaxRub, estimateVoiceTurnMaxRub, liveBetaCostRub } from './live-beta-budget';
import { LIVE_BETA_FOLDER_ID, LIVE_BETA_MODEL, LIVE_BETA_SCOPE, readLiveBetaConfig } from './live-beta-config';

const now = new Date('2026-09-07T12:00:00.000Z');

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    KTOYA_LIVE_BETA_ENABLED: 'true',
    KTOYA_LIVE_API_KEY: 'never-a-real-secret',
    KTOYA_LIVE_KEY_ID: 'test-key-id',
    KTOYA_LIVE_KEY_EXPIRES_AT: '2026-09-14T12:00:00.000Z',
    KTOYA_LIVE_FOLDER_ID: LIVE_BETA_FOLDER_ID,
    KTOYA_LIVE_MODEL: LIVE_BETA_MODEL,
    KTOYA_LIVE_KEY_SCOPES: LIVE_BETA_SCOPE,
    KTOYA_LIVE_CAP_RUB: '100',
    KTOYA_LIVE_IAM_VERIFIED_AT: '2026-09-07T11:00:00.000Z',
    KTOYA_LIVE_TARIFF_VERIFIED_AT: '2026-09-07T11:00:00.000Z',
    KTOYA_LIVE_BILLING_VERIFIED_AT: '2026-09-07T11:00:00.000Z',
    KTOYA_LIVE_INPUT_AUDIO_RUB_PER_SECOND: '0.0264',
    KTOYA_LIVE_OUTPUT_AUDIO_RUB_PER_SECOND: '0.0203',
    KTOYA_LIVE_INPUT_TEXT_RUB_PER_1K_TOKENS: '0.1',
    KTOYA_LIVE_OUTPUT_TEXT_RUB_PER_1K_TOKENS: '0.2',
    ...overrides,
  } as unknown as Cloudflare.Env;
}

describe('closed Beta live provider guardrails', () => {
  it('accepts only the reviewed folder, model, scope, current rates, and 100 RUB cap', () => {
    const config = readLiveBetaConfig(env(), now);
    expect(config).toMatchObject({ folderId: LIVE_BETA_FOLDER_ID, model: LIVE_BETA_MODEL, capRub: LIVE_BETA_CAP_RUB });
    expect(readLiveBetaConfig(env({ KTOYA_LIVE_CAP_RUB: '101' }), now)).toBeNull();
    expect(readLiveBetaConfig(env({ KTOYA_LIVE_KEY_SCOPES: `${LIVE_BETA_SCOPE},yc.ai.speechkitStt.execute` }), now)).toBeNull();
    expect(readLiveBetaConfig(env({ KTOYA_LIVE_INPUT_AUDIO_RUB_PER_SECOND: '0.02' }), now)).toBeNull();
  });

  it('fails closed for stale verification or keys outside the fourteen-day ceiling', () => {
    expect(readLiveBetaConfig(env({ KTOYA_LIVE_IAM_VERIFIED_AT: '2026-09-06T11:59:59.000Z' }), now)).toBeNull();
    expect(readLiveBetaConfig(env({ KTOYA_LIVE_KEY_EXPIRES_AT: '2026-09-22T12:00:01.000Z' }), now)).toBeNull();
    expect(readLiveBetaConfig(env({ KTOYA_LIVE_API_KEY: undefined }), now)).toBeNull();
  });

  it('reserves a conservative worst case and prices actual usage from reviewed units', () => {
    const rates = readLiveBetaConfig(env(), now)!;
    expect(estimateVoiceTurnMaxRub(180_000, rates)).toBeCloseTo(5.921, 6);
    expect(() => estimateVoiceTurnMaxRub(180_001, rates)).toThrow();
    expect(estimateTextOperationMaxRub(10_000, 3_000, rates)).toBeCloseTo(2, 6);
    expect(liveBetaCostRub({ inputAudioMs: 10_000, outputAudioMs: 5_000, inputTokens: 500, outputTokens: 100 }, rates)).toBeCloseTo(0.4355, 6);
  });
});
