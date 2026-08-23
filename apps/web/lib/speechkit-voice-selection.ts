/**
 * Kept outside the provider and UI so the Beta preference is explicit,
 * testable, and can be changed by protected runtime configuration later.
 */
export const SPEECHKIT_TTS_VOICES = ['marina', 'jane', 'dasha', 'julia', 'alexander', 'kirill'] as const;
export type SpeechKitTtsVoice = typeof SPEECHKIT_TTS_VOICES[number];

export const KTOYA_BETA_DEFAULT_TTS_VOICE: SpeechKitTtsVoice = 'marina';

export function isSpeechKitTtsVoice(value: string): value is SpeechKitTtsVoice {
  return (SPEECHKIT_TTS_VOICES as readonly string[]).includes(value);
}

/** Returns null for an invalid protected configuration instead of silently selecting a voice. */
export function resolveSpeechKitDefaultTtsVoice(value: string | undefined): SpeechKitTtsVoice | null {
  if (value === undefined || value === '') return KTOYA_BETA_DEFAULT_TTS_VOICE;
  return isSpeechKitTtsVoice(value) ? value : null;
}
