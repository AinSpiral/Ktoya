import { describe, expect, it } from 'vitest';
import { readAliceTrialConfig } from './ai-trial-config';

function env(overrides: Partial<Cloudflare.Env> = {}) {
  return {
    KTOYA_AI_TRIAL_ENABLED: 'true', KTOYA_AI_API_KEY: 'test-secret-never-log', KTOYA_AI_QA_USER_ID: 'pr12-synthetic-ai-qa', KTOYA_AI_FOLDER_ID: 'b1gkl7lo86seu967m35j', KTOYA_AI_MODEL: 'aliceai-llm',
    KTOYA_AI_BILLING_ACTIVE: 'true', KTOYA_AI_KEY_SCOPES: 'yc.ai.foundationModels.execute', KTOYA_AI_KEY_EXPIRES_AT: '2026-08-30T10:00:00.000Z',
    KTOYA_AI_TARIFF_VERIFIED_AT: '2026-08-23T10:00:00.000Z', KTOYA_AI_BILLING_VERIFIED_AT: '2026-08-23T10:00:00.000Z', KTOYA_AI_IAM_VERIFIED_AT: '2026-08-23T10:00:00.000Z',
    KTOYA_AI_INPUT_RUB_PER_1K_TOKENS: '0.5', KTOYA_AI_OUTPUT_RUB_PER_1K_TOKENS: '1.2', KTOYA_AI_WORKING_CAP_RUB: '60', KTOYA_AI_ABSOLUTE_CAP_RUB: '100',
    ...overrides,
  } as Cloudflare.Env;
}

describe('Alice AI protected trial configuration', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');

  it('requires exact folder, model, least-privilege scope, fresh billing/tariff/IAM evidence and a short key', () => {
    expect(readAliceTrialConfig(env(), now)).toMatchObject({ model: 'aliceai-llm', qaUserId: 'pr12-synthetic-ai-qa', workingCapRub: 60, absoluteCapRub: 100 });
    expect(readAliceTrialConfig(env({ KTOYA_AI_QA_USER_ID: undefined }), now)).toBeNull();
    expect(readAliceTrialConfig(env({ KTOYA_AI_KEY_SCOPES: 'yc.ai.languageModels.execute' }), now)).toBeNull();
    expect(readAliceTrialConfig(env({ KTOYA_AI_FOLDER_ID: 'another-folder' }), now)).toBeNull();
    expect(readAliceTrialConfig(env({ KTOYA_AI_BILLING_ACTIVE: 'false' }), now)).toBeNull();
    expect(readAliceTrialConfig(env({ KTOYA_AI_TARIFF_VERIFIED_AT: '2026-08-20T10:00:00.000Z' }), now)).toBeNull();
    expect(readAliceTrialConfig(env({ KTOYA_AI_KEY_EXPIRES_AT: '2026-09-30T10:00:00.000Z' }), now)).toBeNull();
  });

  it('fails closed above either Author-approved budget boundary', () => {
    expect(readAliceTrialConfig(env({ KTOYA_AI_WORKING_CAP_RUB: '61' }), now)).toBeNull();
    expect(readAliceTrialConfig(env({ KTOYA_AI_ABSOLUTE_CAP_RUB: '101' }), now)).toBeNull();
    expect(readAliceTrialConfig(env({ KTOYA_AI_WORKING_CAP_RUB: '60', KTOYA_AI_ABSOLUTE_CAP_RUB: '50' }), now)).toBeNull();
  });
});
