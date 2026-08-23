import type { AudioFragment, ExternalVoiceProcessingPolicy } from './domain';

export function qaTrialAudioEligibility(input: {
  fragment: AudioFragment;
  ownerPolicy?: ExternalVoiceProcessingPolicy;
}) {
  const derived = input.fragment.derivedAssets?.find((asset) => asset.purpose === 'stt-input');
  if (input.ownerPolicy !== 'qa-nonpersonal-trial' || input.fragment.externalProcessingPolicy !== 'qa-nonpersonal-trial') return { eligible: false as const, reason: 'qa_only' as const };
  if (!derived || !input.fragment.durationMs) return { eligible: false as const, reason: 'derived_audio_required' as const };
  return { eligible: true as const, derived };
}

export function qaTrialStoryEligibility(policy?: ExternalVoiceProcessingPolicy) {
  return policy === 'qa-nonpersonal-trial';
}
