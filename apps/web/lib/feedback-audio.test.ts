import { describe, expect, it } from 'vitest';
import { AudioValidationError, inspectFeedbackAudio } from './feedback-audio';

function wav(seconds: number, declaredDataBytes?: number) {
  const sampleRate = 8_000;
  const dataBytes = declaredDataBytes ?? sampleRate * 2 * seconds;
  const bytes = new Uint8Array(44 + Math.min(dataBytes, sampleRate * 2 * seconds));
  const view = new DataView(bytes.buffer);
  'RIFF'.split('').forEach((char, index) => { bytes[index] = char.charCodeAt(0); });
  view.setUint32(4, bytes.length - 8, true);
  'WAVEfmt '.split('').forEach((char, index) => { bytes[8 + index] = char.charCodeAt(0); });
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  'data'.split('').forEach((char, index) => { bytes[36 + index] = char.charCodeAt(0); });
  view.setUint32(40, dataBytes, true);
  return bytes;
}

describe('feedback audio validation', () => {
  it('derives duration and MIME from bytes instead of trusting client metadata', () => {
    expect(inspectFeedbackAudio(wav(12), 'audio/wav; codecs=1')).toEqual({
      mime: 'audio/wav',
      extension: 'wav',
      durationMs: 12_000,
    });
  });

  it('rejects a declared MIME that disagrees with the file signature', () => {
    expect(() => inspectFeedbackAudio(wav(1), 'audio/webm')).toThrowError(AudioValidationError);
  });

  it('rejects audio whose server-derived duration exceeds three minutes', () => {
    const oversizedDuration = wav(181);
    expect(() => inspectFeedbackAudio(oversizedDuration, 'audio/wav')).toThrow('длиннее 3 минут');
  });
});
