import { FRIENDS_BETA_LIMITS } from './friends-limits';

export type InspectedAudio = {
  mime: 'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/wav';
  extension: 'webm' | 'ogg' | 'm4a' | 'wav';
  durationMs: number;
};

export class AudioValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function readUnsigned(bytes: Uint8Array, offset: number, length: number) {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[offset + index];
  return value;
}

function readVint(bytes: Uint8Array, offset: number, retainMarker = false) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = retainMarker ? first : first & (mask - 1);
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index];
  return { length, value };
}

function webmDuration(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let timecodeScale = 1_000_000;
  let declaredUnits = 0;
  let maxUnits = 0;
  const containers = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1f43b675, 0xa0]);

  const walk = (start: number, end: number, inheritedCluster = 0) => {
    let offset = start;
    let cluster = inheritedCluster;
    while (offset < end) {
      const id = readVint(bytes, offset, true);
      if (!id) break;
      const size = readVint(bytes, offset + id.length);
      if (!size) break;
      const payloadStart = offset + id.length + size.length;
      const unknownSize = size.value === 2 ** (7 * size.length) - 1;
      const payloadEnd = unknownSize ? end : Math.min(end, payloadStart + size.value);
      if (payloadStart > payloadEnd || payloadStart > bytes.length) break;

      if (id.value === 0x2ad7b1 && size.value > 0 && size.value <= 8) {
        timecodeScale = readUnsigned(bytes, payloadStart, size.value);
      } else if (id.value === 0x4489 && (size.value === 4 || size.value === 8)) {
        declaredUnits = size.value === 4 ? view.getFloat32(payloadStart) : view.getFloat64(payloadStart);
      } else if (id.value === 0xe7 && size.value > 0 && size.value <= 8) {
        cluster = readUnsigned(bytes, payloadStart, size.value);
      } else if ((id.value === 0xa3 || id.value === 0xa1) && size.value >= 4) {
        const track = readVint(bytes, payloadStart);
        if (track && payloadStart + track.length + 2 <= payloadEnd) {
          const relative = view.getInt16(payloadStart + track.length);
          maxUnits = Math.max(maxUnits, cluster + relative);
        }
      } else if (containers.has(id.value)) {
        walk(payloadStart, payloadEnd, id.value === 0x1f43b675 ? cluster : inheritedCluster);
      }
      offset = payloadEnd > offset ? payloadEnd : offset + 1;
    }
  };

  walk(0, bytes.length);
  const units = Math.max(declaredUnits, maxUnits);
  return units > 0 && Number.isFinite(units) ? units * timecodeScale / 1_000_000 : 0;
}

function wavDuration(bytes: Uint8Array) {
  if (bytes.length < 44 || !bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || !bytesEqual(bytes, 8, [0x57, 0x41, 0x56, 0x45])) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16 && offset + 20 <= bytes.length) byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') {
      dataBytes = Math.min(size, Math.max(0, bytes.length - offset - 8));
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate * 1_000 : 0;
}

function oggDuration(bytes: Uint8Array) {
  let lastGranule = 0;
  let offset = 0;
  while (offset + 27 <= bytes.length) {
    if (!bytesEqual(bytes, offset, [0x4f, 0x67, 0x67, 0x53])) {
      offset += 1;
      continue;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(bytes.length - offset, 27));
    const low = view.getUint32(6, true);
    const high = view.getUint32(10, true);
    const segments = bytes[offset + 26];
    if (offset + 27 + segments > bytes.length) break;
    let payload = 0;
    for (let index = 0; index < segments; index += 1) payload += bytes[offset + 27 + index];
    lastGranule = Math.max(lastGranule, high * 2 ** 32 + low);
    offset += 27 + segments + payload;
  }
  return lastGranule > 0 ? lastGranule / 48_000 * 1_000 : 0;
}

function mp4Duration(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (size < 8 || offset + size > bytes.length) break;
    if (type === 'moov') {
      let child = offset + 8;
      while (child + 8 <= offset + size) {
        const childSize = view.getUint32(child);
        const childType = String.fromCharCode(...bytes.slice(child + 4, child + 8));
        if (childSize < 8 || child + childSize > offset + size) break;
        if (childType === 'mvhd') {
          const version = bytes[child + 8];
          const base = child + 8;
          const scaleOffset = version === 1 ? base + 20 : base + 12;
          const durationOffset = scaleOffset + 4;
          if (durationOffset + (version === 1 ? 8 : 4) > child + childSize) return 0;
          const scale = view.getUint32(scaleOffset);
          const duration = version === 1
            ? view.getUint32(durationOffset) * 2 ** 32 + view.getUint32(durationOffset + 4)
            : view.getUint32(durationOffset);
          return scale > 0 ? duration / scale * 1_000 : 0;
        }
        child += childSize;
      }
    }
    offset += size;
  }
  return 0;
}

function normalizedDeclaredMime(value: string) {
  const mime = value.toLowerCase().split(';', 1)[0].trim();
  return mime === 'audio/x-wav' ? 'audio/wav' : mime;
}

export function inspectFeedbackAudio(input: ArrayBuffer | Uint8Array, declaredMime: string): InspectedAudio {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) throw new AudioValidationError('empty_audio', 'Аудиофайл пуст.');
  if (bytes.length > FRIENDS_BETA_LIMITS.singleAudioBytes) {
    throw new AudioValidationError('audio_too_large', 'Аудиофайл превышает допустимый размер 16 МБ.');
  }

  let result: InspectedAudio | null = null;
  if (bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    result = { mime: 'audio/webm', extension: 'webm', durationMs: webmDuration(bytes) };
  } else if (bytesEqual(bytes, 0, [0x4f, 0x67, 0x67, 0x53])) {
    result = { mime: 'audio/ogg', extension: 'ogg', durationMs: oggDuration(bytes) };
  } else if (bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && bytesEqual(bytes, 8, [0x57, 0x41, 0x56, 0x45])) {
    result = { mime: 'audio/wav', extension: 'wav', durationMs: wavDuration(bytes) };
  } else if (bytes.length > 12 && bytesEqual(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    result = { mime: 'audio/mp4', extension: 'm4a', durationMs: mp4Duration(bytes) };
  }

  if (!result || normalizedDeclaredMime(declaredMime) !== result.mime) {
    throw new AudioValidationError('unsupported_audio_type', 'Формат аудио не поддерживается или не совпадает с содержимым файла.');
  }
  if (!result.durationMs || !Number.isFinite(result.durationMs)) {
    throw new AudioValidationError('unknown_audio_duration', 'Не удалось безопасно определить длительность аудио.');
  }
  if (result.durationMs > FRIENDS_BETA_LIMITS.singleAudioDurationMs) {
    throw new AudioValidationError('audio_too_long', 'Один голосовой отзыв не может быть длиннее 3 минут.');
  }
  return { ...result, durationMs: Math.ceil(result.durationMs) };
}
