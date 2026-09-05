import { AudioValidationError, inspectFeedbackAudio } from './feedback-audio';
import { FEEDBACK_CATEGORIES, FRIENDS_BETA_LIMITS, utcDayStart, utcMonthKey, type FeedbackCategory } from './friends-limits';

export type FeedbackStatus = 'NEW' | 'READ' | 'NEEDS_WORK' | 'DONE';

type FeedbackSubmission = {
  id: string;
  category: FeedbackCategory;
  nickname: string;
  text: string;
  draftTranscript: string;
  consent: boolean;
  route: string;
  viewportWidth: number;
  viewportHeight: number;
  audio: File | null;
};

export class FeedbackSubmissionError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
  }
}

function textField(value: FormDataEntryValue | null, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberField(value: FormDataEntryValue | null) {
  const parsed = typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function parseFeedbackForm(form: FormData): FeedbackSubmission {
  const id = textField(form.get('id'), 64);
  const category = textField(form.get('category'), 32) as FeedbackCategory;
  const audioValue = form.get('audio');
  const audio = audioValue instanceof File && audioValue.size > 0 ? audioValue : null;
  const submission = {
    id,
    category,
    nickname: textField(form.get('nickname'), 80),
    text: textField(form.get('text'), 5_000),
    draftTranscript: textField(form.get('draftTranscript'), 20_000),
    consent: form.get('consent') === 'true',
    route: textField(form.get('route'), 256),
    viewportWidth: numberField(form.get('viewportWidth')),
    viewportHeight: numberField(form.get('viewportHeight')),
    audio,
  };
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new FeedbackSubmissionError('invalid_id', 400, 'Некорректный идентификатор отзыва.');
  if (!FEEDBACK_CATEGORIES.includes(category)) throw new FeedbackSubmissionError('invalid_category', 400, 'Выберите тип отзыва.');
  if (!submission.consent) throw new FeedbackSubmissionError('consent_required', 400, 'Нужно подтвердить согласие на сохранение отзыва.');
  if (!submission.text && !submission.draftTranscript && !audio) throw new FeedbackSubmissionError('empty_feedback', 400, 'Добавьте текст или голосовую запись.');
  if (!submission.route.startsWith('/')) submission.route = '/';
  submission.viewportWidth = Math.min(10_000, submission.viewportWidth || 1);
  submission.viewportHeight = Math.min(10_000, submission.viewportHeight || 1);
  return submission;
}

async function resetUsageMonth(db: D1Database, now: string) {
  const month = utcMonthKey(new Date(now));
  await db.prepare(`UPDATE friends_feedback_usage
    SET month_key = ?, class_a_operations = 0, class_b_operations = 0, updated_at = ?
    WHERE scope = 'global' AND month_key <> ?`).bind(month, now, month).run();
}

async function dailyCounts(db: D1Database, sessionId: string, now: string) {
  return db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN kind = 'voice' THEN 1 ELSE 0 END) AS voice
    FROM friends_feedback WHERE tester_session_id = ? AND created_at >= ?`)
    .bind(sessionId, utcDayStart(new Date(now)))
    .first<{ total: number; voice: number | null }>();
}

export async function feedbackUsage(db: D1Database) {
  const row = await db.prepare(`SELECT total_audio_bytes, reserved_audio_bytes, month_key,
      class_a_operations, class_b_operations
    FROM friends_feedback_usage WHERE scope = 'global'`)
    .first<{ total_audio_bytes: number; reserved_audio_bytes: number; month_key: string; class_a_operations: number; class_b_operations: number }>();
  return {
    totalAudioBytes: row?.total_audio_bytes ?? 0,
    reservedAudioBytes: row?.reserved_audio_bytes ?? 0,
    monthKey: row?.month_key ?? utcMonthKey(),
    classAOperations: row?.class_a_operations ?? 0,
    classBOperations: row?.class_b_operations ?? 0,
    limits: FRIENDS_BETA_LIMITS,
  };
}

export async function reserveFeedbackAudio(db: D1Database, bytes: number, now: string) {
  await resetUsageMonth(db, now);
  const result = await db.prepare(`UPDATE friends_feedback_usage
    SET reserved_audio_bytes = reserved_audio_bytes + ?,
        class_a_operations = class_a_operations + 1, updated_at = ?
    WHERE scope = 'global'
      AND total_audio_bytes + reserved_audio_bytes + ? <= ?
      AND class_a_operations < ?`)
    .bind(bytes, now, bytes, FRIENDS_BETA_LIMITS.totalAudioBytes, FRIENDS_BETA_LIMITS.classAPerMonth).run();
  if ((result.meta.changes ?? 0) > 0) return;
  const usage = await feedbackUsage(db);
  if (usage.totalAudioBytes + usage.reservedAudioBytes + bytes > FRIENDS_BETA_LIMITS.totalAudioBytes) {
    throw new FeedbackSubmissionError('audio_storage_limit', 507, 'Лимит аудиохранилища Friends Beta достигнут. Текстовый отзыв всё ещё можно отправить.');
  }
  throw new FeedbackSubmissionError('class_a_limit', 429, 'Месячный лимит операций загрузки Friends Beta достигнут. Текстовый отзыв всё ещё можно отправить.');
}

async function releaseReservation(db: D1Database, bytes: number, now: string) {
  await db.prepare(`UPDATE friends_feedback_usage
    SET reserved_audio_bytes = MAX(0, reserved_audio_bytes - ?), updated_at = ?
    WHERE scope = 'global'`).bind(bytes, now).run();
}

export async function saveFeedback(input: {
  db: D1Database;
  bucket: R2Bucket;
  sessionId: string;
  buildId: string;
  form: FormData;
  now?: string;
}) {
  const submission = parseFeedbackForm(input.form);
  const now = input.now ?? new Date().toISOString();
  const existing = await input.db.prepare('SELECT tester_session_id, status FROM friends_feedback WHERE feedback_id = ?')
    .bind(submission.id).first<{ tester_session_id: string; status: FeedbackStatus }>();
  if (existing) {
    if (existing.tester_session_id !== input.sessionId) throw new FeedbackSubmissionError('id_conflict', 409, 'Идентификатор отзыва уже используется.');
    return { id: submission.id, duplicate: true, status: existing.status };
  }
  const counts = await dailyCounts(input.db, input.sessionId, now);
  if ((counts?.total ?? 0) >= FRIENDS_BETA_LIMITS.feedbackPerSessionPerDay) {
    throw new FeedbackSubmissionError('daily_feedback_limit', 429, 'Дневной лимит отзывов этой сессии достигнут.');
  }
  if (submission.audio && (counts?.voice ?? 0) >= FRIENDS_BETA_LIMITS.voicePerSessionPerDay) {
    throw new FeedbackSubmissionError('daily_voice_limit', 429, 'Можно отправить не больше 5 голосовых отзывов в сутки. Текстовый отзыв доступен.');
  }

  let inspected: ReturnType<typeof inspectFeedbackAudio> | null = null;
  let audioKey: string | null = null;
  if (submission.audio) {
    if (submission.audio.size > FRIENDS_BETA_LIMITS.singleAudioBytes) {
      throw new FeedbackSubmissionError('audio_too_large', 413, 'Аудиофайл превышает допустимый размер 16 МБ.');
    }
    const bytes = await submission.audio.arrayBuffer();
    try { inspected = inspectFeedbackAudio(bytes, submission.audio.type); }
    catch (error) {
      if (error instanceof AudioValidationError) throw new FeedbackSubmissionError(error.code, 415, error.message);
      throw error;
    }
    await reserveFeedbackAudio(input.db, submission.audio.size, now);
    audioKey = `feedback/${input.sessionId}/${submission.id}.${inspected.extension}`;
    try {
      await input.bucket.put(audioKey, bytes, {
        httpMetadata: { contentType: inspected.mime },
        customMetadata: { feedbackId: submission.id },
      });
    } catch (error) {
      await releaseReservation(input.db, submission.audio.size, now);
      throw error;
    }
  }

  const kind = submission.audio ? 'voice' : 'text';
  const transcriptState = submission.draftTranscript ? 'browser_draft' : 'unavailable';
  const statements: D1PreparedStatement[] = [
    input.db.prepare(`INSERT INTO friends_feedback
      (feedback_id, tester_session_id, kind, category, nickname, body, audio_key, audio_bytes,
       audio_duration_ms, audio_mime, transcript_state, status, route, build_id,
       viewport_width, viewport_height, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?)`)
      .bind(submission.id, input.sessionId, kind, submission.category, submission.nickname || null,
        submission.text || null, audioKey, submission.audio?.size ?? null, inspected?.durationMs ?? null,
        inspected?.mime ?? null, transcriptState, submission.route, input.buildId,
        submission.viewportWidth, submission.viewportHeight, now, now),
  ];
  if (submission.draftTranscript) {
    statements.push(input.db.prepare(`INSERT INTO friends_feedback_transcript_revisions
      (revision_id, feedback_id, source, body, created_at) VALUES (?, ?, 'browser_draft', ?, ?)`)
      .bind(crypto.randomUUID(), submission.id, submission.draftTranscript, now));
  }
  if (submission.audio) {
    statements.push(input.db.prepare(`UPDATE friends_feedback_usage
      SET reserved_audio_bytes = MAX(0, reserved_audio_bytes - ?),
          total_audio_bytes = total_audio_bytes + ?, updated_at = ?
      WHERE scope = 'global'`).bind(submission.audio.size, submission.audio.size, now));
  }
  // If R2 succeeded but the metadata transaction fails, keep the reservation.
  // This intentionally fails closed: an orphaned private object must still count
  // against the hard 500 MB ceiling until an owner performs a manual audit.
  await input.db.batch(statements);
  return { id: submission.id, duplicate: false, status: 'NEW' as const };
}

export async function reserveClassBOperation(db: D1Database, now = new Date().toISOString()) {
  await resetUsageMonth(db, now);
  const result = await db.prepare(`UPDATE friends_feedback_usage
    SET class_b_operations = class_b_operations + 1, updated_at = ?
    WHERE scope = 'global' AND class_b_operations < ?`)
    .bind(now, FRIENDS_BETA_LIMITS.classBPerMonth).run();
  if ((result.meta.changes ?? 0) < 1) throw new FeedbackSubmissionError('class_b_limit', 429, 'Месячный лимит чтения аудио Friends Beta достигнут.');
}

export async function saveSessionMedia(input: {
  db: D1Database;
  bucket: R2Bucket;
  sessionId: string;
  objectKey: string;
  bytes: ArrayBuffer;
  declaredMime: string;
  now?: string;
}) {
  const existing = await input.db.prepare('SELECT owner_session_id FROM friends_media_objects WHERE object_key = ?')
    .bind(input.objectKey).first<{ owner_session_id: string }>();
  if (existing) {
    if (existing.owner_session_id !== input.sessionId) throw new FeedbackSubmissionError('media_conflict', 409, 'Этот идентификатор аудио уже используется.');
    return { key: input.objectKey, duplicate: true };
  }
  let inspected;
  try { inspected = inspectFeedbackAudio(input.bytes, input.declaredMime); }
  catch (error) {
    if (error instanceof AudioValidationError) throw new FeedbackSubmissionError(error.code, 415, error.message);
    throw error;
  }
  const now = input.now ?? new Date().toISOString();
  await reserveFeedbackAudio(input.db, input.bytes.byteLength, now);
  try {
    await input.bucket.put(input.objectKey, input.bytes, {
      httpMetadata: { contentType: inspected.mime },
      customMetadata: { ownerSessionId: input.sessionId },
    });
  } catch (error) {
    // Keep the reservation after a successful R2 write so quota accounting
    // remains conservative even if the D1 metadata transaction failed.
    throw error;
  }
  try {
    await input.db.batch([
      input.db.prepare(`INSERT INTO friends_media_objects
        (object_key, owner_session_id, byte_size, content_type, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(input.objectKey, input.sessionId, input.bytes.byteLength, inspected.mime, inspected.durationMs, now),
      input.db.prepare(`UPDATE friends_feedback_usage
        SET reserved_audio_bytes = MAX(0, reserved_audio_bytes - ?),
            total_audio_bytes = total_audio_bytes + ?, updated_at = ?
        WHERE scope = 'global'`).bind(input.bytes.byteLength, input.bytes.byteLength, now),
    ]);
  } catch (error) {
    await releaseReservation(input.db, input.bytes.byteLength, now);
    throw error;
  }
  return { key: input.objectKey, duplicate: false };
}
