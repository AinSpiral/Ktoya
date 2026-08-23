import { describe, expect, it } from 'vitest';
import type { AudioFragment } from './domain';
import { qaTrialAudioEligibility, qaTrialStoryEligibility } from './voice-trial-policy';

const base: AudioFragment = { id: 'audio-qa-1', position: 1, createdAt: '2026-08-23T10:00:00.000Z', contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'user/story/audio.webm' };

describe('SpeechKit trial privacy gate', () => {
  it('rejects every historical or personal fragment before provider access', () => {
    expect(qaTrialAudioEligibility({ fragment: base, ownerPolicy: undefined })).toEqual({ eligible: false, reason: 'qa_only' });
    expect(qaTrialStoryEligibility(undefined)).toBe(false);
  });

  it('requires both explicit QA policy and a separate derived provider asset', () => {
    const marked = { ...base, externalProcessingPolicy: 'qa-nonpersonal-trial' as const };
    expect(qaTrialAudioEligibility({ fragment: marked, ownerPolicy: 'qa-nonpersonal-trial' })).toEqual({ eligible: false, reason: 'derived_audio_required' });
    const derived = { id: 'derived-qa-1', sourceAudioFragmentId: base.id, purpose: 'stt-input' as const, objectKey: 'user/story/derived/audio.wav', contentType: 'audio/wav' as const, derivation: 'transcode-pcm-wav' as const, createdAt: base.createdAt, byteLength: 32044, durationMs: 1000 };
    expect(qaTrialAudioEligibility({ fragment: { ...marked, durationMs: 1000, derivedAssets: [derived] }, ownerPolicy: 'qa-nonpersonal-trial' })).toEqual({ eligible: true, derived });
  });
});
