import type { TranscriptionProvider, TTSProvider } from './adapters';

export interface VoiceProviderCapabilities {
  transcription: { available: boolean; retrySavedAudio: boolean; message: string };
  narration: { available: boolean; reusableAudio: boolean; message: string };
  trialQaOnly?: boolean;
}

export interface VoiceProviderRegistry {
  transcription: TranscriptionProvider | null;
  narration: TTSProvider | null;
}

/**
 * Deliberately unconfigured until the Author approves a paid provider and its
 * data-processing terms. No environment variable or secret can accidentally
 * turn a placeholder into a claimed production integration.
 */
export function configuredVoiceProviders(): VoiceProviderRegistry {
  return { transcription: null, narration: null };
}

export function voiceProviderCapabilities(registry = configuredVoiceProviders()): VoiceProviderCapabilities {
  return {
    transcription: registry.transcription
      ? { available: true, retrySavedAudio: true, message: 'Качественная расшифровка доступна.' }
      : { available: false, retrySavedAudio: false, message: 'Production STT ещё не подключён. Оригинал и ручная коррекция доступны без него.' },
    narration: registry.narration
      ? { available: true, reusableAudio: true, message: 'Профессиональная озвучка доступна.' }
      : { available: false, reusableAudio: false, message: 'Production TTS ещё не подключён. Системный голос браузера не используется как замена.' },
  };
}

export function speechKitTrialCapabilities(configured: boolean): VoiceProviderCapabilities {
  return configured ? {
    transcription: { available: true, retrySavedAudio: true, message: 'SpeechKit доступен только для новых явно отмеченных неперсональных QA-записей. Оригинал не отправляется: используется отдельный WAV/OGG derived asset.' },
    narration: { available: true, reusableAudio: true, message: 'SpeechKit TTS доступен только для новой неперсональной QA-истории trial.' },
    trialQaOnly: true,
  } : {
    ...voiceProviderCapabilities(),
    trialQaOnly: true,
  };
}
