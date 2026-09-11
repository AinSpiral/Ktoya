import { describe, expect, it, vi } from 'vitest';
import { hasMeteredR2Object, parseFeedbackForm, reserveClassBOperation, reserveFeedbackAudio, saveSessionMedia } from './feedback-store';
import { FRIENDS_BETA_LIMITS } from './friends-limits';

type Usage = {
  total_audio_bytes: number;
  reserved_audio_bytes: number;
  month_key: string;
  class_a_operations: number;
  class_b_operations: number;
};

function quotaDb(usage: Usage, reserveChanges: number) {
  return {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async run() {
          if (sql.includes('reserved_audio_bytes = reserved_audio_bytes +')) return { meta: { changes: reserveChanges } };
          if (sql.includes('class_b_operations = class_b_operations +')) return { meta: { changes: reserveChanges } };
          return { meta: { changes: 0 } };
        },
        async first() { return usage; },
      };
    },
  } as unknown as D1Database;
}

const baseUsage: Usage = {
  total_audio_bytes: 0,
  reserved_audio_bytes: 0,
  month_key: '2026-09',
  class_a_operations: 0,
  class_b_operations: 0,
};

function wavOneSecond() {
  const sampleRate = 8_000;
  const dataBytes = sampleRate * 2;
  const bytes = new Uint8Array(44 + dataBytes);
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
  return bytes.buffer;
}

function mediaDb(committed?: { owner_session_id: string; byte_size: number }) {
  let objectLookupCount = 0;
  let releases = 0;
  const db = {
    prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async first() {
          if (sql.includes('friends_media_objects')) {
            objectLookupCount += 1;
            return objectLookupCount === 1 ? null : committed ?? null;
          }
          return baseUsage;
        },
        async run() {
          if (sql.includes('reserved_audio_bytes = reserved_audio_bytes +')) return { meta: { changes: 1 } };
          if (sql.includes('reserved_audio_bytes = MAX(0, reserved_audio_bytes -')) releases += 1;
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
    async batch() { throw new Error('simulated D1 failure'); },
  } as unknown as D1Database;
  return { db, releaseCount: () => releases };
}

describe('Friends Beta hard feedback limits', () => {
  it('rejects storage beyond the global 500 MB ceiling without deleting old audio', async () => {
    const db = quotaDb({ ...baseUsage, total_audio_bytes: FRIENDS_BETA_LIMITS.totalAudioBytes }, 0);
    await expect(reserveFeedbackAudio(db, 1, '2026-09-05T00:00:00.000Z')).rejects.toMatchObject({ code: 'audio_storage_limit', status: 507 });
  });

  it('rejects Class A and Class B operations at the conservative monthly ceilings', async () => {
    const a = quotaDb({ ...baseUsage, class_a_operations: FRIENDS_BETA_LIMITS.classAPerMonth }, 0);
    await expect(reserveFeedbackAudio(a, 1, '2026-09-05T00:00:00.000Z')).rejects.toMatchObject({ code: 'class_a_limit', status: 429 });
    const b = quotaDb({ ...baseUsage, class_b_operations: FRIENDS_BETA_LIMITS.classBPerMonth }, 0);
    await expect(reserveClassBOperation(b, '2026-09-05T00:00:00.000Z')).rejects.toMatchObject({ code: 'class_b_limit', status: 429 });
  });

  it('accepts text-only feedback even when no audio is attached', () => {
    const form = new FormData();
    form.set('id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    form.set('category', 'idea');
    form.set('text', 'Оставить текстовый отзыв.');
    form.set('consent', 'true');
    form.set('route', '/#landing');
    expect(parseFeedbackForm(form)).toMatchObject({ category: 'idea', text: 'Оставить текстовый отзыв.', audio: null });
  });

  it('meters every R2 HEAD and does not call R2 after the Class B ceiling', async () => {
    const head = vi.fn().mockResolvedValue({ key: 'present' });
    const accepted = quotaDb(baseUsage, 1);
    await expect(hasMeteredR2Object(accepted, { head } as unknown as R2Bucket, 'key')).resolves.toBe(true);
    expect(head).toHaveBeenCalledOnce();

    head.mockClear();
    const rejected = quotaDb({ ...baseUsage, class_b_operations: FRIENDS_BETA_LIMITS.classBPerMonth }, 0);
    await expect(hasMeteredR2Object(rejected, { head } as unknown as R2Bucket, 'key')).rejects.toMatchObject({ code: 'class_b_limit' });
    expect(head).not.toHaveBeenCalled();
  });

  it('releases the byte reservation when R2 rejects a media write', async () => {
    const { db, releaseCount } = mediaDb();
    const bucket = { put: vi.fn().mockRejectedValue(new Error('simulated R2 failure')) } as unknown as R2Bucket;
    await expect(saveSessionMedia({ db, bucket, sessionId: 'tester-a', objectKey: 'friends/tester-a/a.wav', bytes: wavOneSecond(), declaredMime: 'audio/wav' }))
      .rejects.toThrow('simulated R2 failure');
    expect(releaseCount()).toBe(1);
  });

  it('keeps the reservation after a post-R2 D1 failure without a committed owner row', async () => {
    const { db, releaseCount } = mediaDb();
    const bucket = { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket;
    await expect(saveSessionMedia({ db, bucket, sessionId: 'tester-a', objectKey: 'friends/tester-a/a.wav', bytes: wavOneSecond(), declaredMime: 'audio/wav' }))
      .rejects.toThrow('simulated D1 failure');
    expect(releaseCount()).toBe(0);
  });

  it('releases only the extra reservation for a proven identical concurrent media commit', async () => {
    const bytes = wavOneSecond();
    const { db, releaseCount } = mediaDb({ owner_session_id: 'tester-a', byte_size: bytes.byteLength });
    const bucket = { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket;
    await expect(saveSessionMedia({ db, bucket, sessionId: 'tester-a', objectKey: 'friends/tester-a/a.wav', bytes, declaredMime: 'audio/wav' }))
      .resolves.toEqual({ key: 'friends/tester-a/a.wav', duplicate: true });
    expect(releaseCount()).toBe(1);
  });
});
