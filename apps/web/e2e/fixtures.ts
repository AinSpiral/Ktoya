import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Nonpersonal, offline PCM transport markers, not speech and not an STT score.
// Distinct thirds prove that >100s did not silently lose its middle or tail.
export function audioFixture(name: 'story' | 'answer' | 'long') {
  const duration = { story: 12, answer: 6, long: 106 }[name];
  const rate = 48_000;
  const samples = duration * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const seconds = i / rate;
    const frequency = [440, 660, 880][Math.min(2, Math.floor(seconds / (duration / 3)))];
    const envelope = Math.min(1, (seconds % 1) * 50, (1 - seconds % 1) * 50);
    buffer.writeInt16LE(Math.round(8_000 * envelope * Math.sin(2 * Math.PI * frequency * seconds)), 44 + i * 2);
  }
  const directory = resolve('e2e/.generated/audio');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${name}.wav`);
  writeFileSync(path, buffer);
  return path;
}
