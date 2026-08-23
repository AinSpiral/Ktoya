import { describe, expect, it } from 'vitest';
import { KTOYA_BETA_DEFAULT_TTS_VOICE, SPEECHKIT_TTS_VOICES, resolveSpeechKitDefaultTtsVoice } from './speechkit-voice-selection';

describe('SpeechKit Beta voice selection', () => {
  it('uses the human-accepted marina voice when protected configuration is absent', () => {
    expect(KTOYA_BETA_DEFAULT_TTS_VOICE).toBe('marina');
    expect(resolveSpeechKitDefaultTtsVoice(undefined)).toBe('marina');
  });

  it('allows a later approved voice change without changing historical narration assets', () => {
    expect(resolveSpeechKitDefaultTtsVoice('jane')).toBe('jane');
    expect(SPEECHKIT_TTS_VOICES).toContain('marina');
  });

  it('rejects an unknown configured voice instead of falling back silently', () => {
    expect(resolveSpeechKitDefaultTtsVoice('unreviewed-voice')).toBeNull();
  });
});
