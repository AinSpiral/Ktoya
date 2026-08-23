import { describe, expect, it } from 'vitest';
import type { TranscriptionProvider, TTSProvider } from './adapters';
import { configuredVoiceProviders, speechKitTrialCapabilities, voiceProviderCapabilities } from './voice-provider-registry';

describe('voice provider registry', () => {
  it('keeps paid providers explicitly unavailable until a provider decision is implemented', () => {
    expect(configuredVoiceProviders()).toEqual({ transcription: null, narration: null });
    expect(voiceProviderCapabilities()).toMatchObject({
      transcription: { available: false, retrySavedAudio: false },
      narration: { available: false, reusableAudio: false },
    });
  });

  it('exposes product capabilities without leaking provider credentials or details', () => {
    const transcription: TranscriptionProvider = { id: 'chosen-stt', submit: async () => ({ status: 'ready', value: { text: 'Текст' } }) };
    const narration: TTSProvider = { id: 'chosen-tts', submit: async () => ({ status: 'ready', value: { audio: new ArrayBuffer(1), contentType: 'audio/mpeg' } }) };
    const capabilities = voiceProviderCapabilities({ transcription, narration });
    expect(capabilities).toEqual({
      transcription: { available: true, retrySavedAudio: true, message: 'Качественная расшифровка доступна.' },
      narration: { available: true, reusableAudio: true, message: 'Профессиональная озвучка доступна.' },
    });
    expect(JSON.stringify(capabilities)).not.toContain('chosen-stt');
    expect(JSON.stringify(capabilities)).not.toContain('chosen-tts');
  });

  it('exposes only the configured default voice needed for one author-facing narration path', () => {
    expect(speechKitTrialCapabilities(true, 'marina')).toMatchObject({
      trialQaOnly: true,
      defaultNarrationVoiceId: 'marina',
      narration: { available: true, reusableAudio: true },
    });
  });
});
