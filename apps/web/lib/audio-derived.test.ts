import { describe, expect, it } from 'vitest';
import { encodePcm16Wav } from './audio-derived';

describe('immutable-original derived audio', () => {
  it('encodes a separate mono PCM16 WAV with correct header and length', () => {
    const source = new Float32Array([-1, 0, 1]);
    const wav = encodePcm16Wav(source, 16000);
    const bytes = new Uint8Array(wav);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(wav.byteLength).toBe(50);
    expect(source).toEqual(new Float32Array([-1, 0, 1]));
  });
});
