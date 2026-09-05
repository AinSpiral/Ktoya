import { describe, expect, it } from 'vitest';
import { parseFeedbackForm, reserveClassBOperation, reserveFeedbackAudio } from './feedback-store';
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
});
