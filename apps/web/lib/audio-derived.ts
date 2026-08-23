export function encodePcm16Wav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/**
 * Chrome has no safe native WebM/Opus -> OGG/Opus remux API. For the trial we
 * therefore decode a copy and create mono 16 kHz PCM WAV; the WebM stays intact.
 */
export async function deriveSpeechKitWav(original: Blob) {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('Браузер не поддерживает создание технической WAV-копии. Оригинал сохранён.');
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await original.arrayBuffer());
    const sampleRate = 16_000;
    const length = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const wav = encodePcm16Wav(rendered.getChannelData(0), sampleRate);
    return { blob: new Blob([wav], { type: 'audio/wav' }), durationMs: Math.ceil(decoded.duration * 1000), byteLength: wav.byteLength };
  } finally {
    await context.close();
  }
}
