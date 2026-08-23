import { describe, expect, it } from 'vitest';
import { ABSOLUTE_TRIAL_CAP_RUB, PUBLIC_STT_RUB_PER_SECOND, PUBLIC_TTS_RUB_PER_250_CHARS, estimateAsyncSttRub, estimateTrialPlanRub, estimateTtsRub } from './voice-trial-budget';

describe('SpeechKit trial cost guard', () => {
  it('uses async STT minimum and per-second billing from second 16', () => {
    expect(estimateAsyncSttRub(5_000, PUBLIC_STT_RUB_PER_SECOND)).toBeCloseTo(0.1515, 6);
    expect(estimateAsyncSttRub(15_500, PUBLIC_STT_RUB_PER_SECOND)).toBeCloseTo(0.1616, 6);
  });

  it('uses one TTS v3 billing unit per started 250 characters', () => {
    expect(estimateTtsRub('x'.repeat(1), PUBLIC_TTS_RUB_PER_250_CHARS)).toBeCloseTo(0.1626, 6);
    expect(estimateTtsRub('x'.repeat(251), PUBLIC_TTS_RUB_PER_250_CHARS)).toBeCloseTo(0.3252, 6);
  });

  it('keeps the planned acceptance trial far below the absolute Author cap', () => {
    const total = estimateTrialPlanRub({ sttDurationsSeconds: [20, 150, 60], ttsCharactersPerVoice: 1000, ttsVoiceCount: 6, retryMultiplier: 2 }, { sttRubPerSecond: PUBLIC_STT_RUB_PER_SECOND, ttsRubPer250Chars: PUBLIC_TTS_RUB_PER_250_CHARS });
    expect(total).toBeCloseTo(12.4508, 4);
    expect(total).toBeLessThan(25);
    expect(total).toBeLessThan(ABSOLUTE_TRIAL_CAP_RUB);
  });
});
