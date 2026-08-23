import { describe, expect, it } from 'vitest';
import { canUseAliceTrial } from './ai-trial-policy';
import type { AliceTrialConfig } from './ai-trial-config';

const config = { model: 'aliceai-llm', qaUserId: 'pr12-synthetic-ai-qa' } as AliceTrialConfig;

describe('Alice trial privacy gate', () => {
  it('fails closed for personal, legacy, absent-policy, and invalid-config material', () => {
    expect(canUseAliceTrial(config, undefined, 'pr12-synthetic-ai-qa', 'localhost')).toBe(false);
    expect(canUseAliceTrial(config, 'user-content-approved', 'pr12-synthetic-ai-qa', 'localhost')).toBe(false);
    expect(canUseAliceTrial(null, 'qa-nonpersonal-trial', 'pr12-synthetic-ai-qa', 'localhost')).toBe(false);
  });

  it('opens only for the protected QA identity on loopback with explicit nonpersonal policy', () => {
    expect(canUseAliceTrial(config, 'qa-nonpersonal-trial', 'pr12-synthetic-ai-qa', 'localhost')).toBe(true);
    expect(canUseAliceTrial(config, 'qa-nonpersonal-trial', 'another-user', 'localhost')).toBe(false);
    expect(canUseAliceTrial(config, 'qa-nonpersonal-trial', 'pr12-synthetic-ai-qa', 'ktoya.example')).toBe(false);
  });
});
