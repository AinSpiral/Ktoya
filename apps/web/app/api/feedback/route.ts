import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { FeedbackSubmissionError, saveFeedback } from '@/lib/feedback-store';
import { ensureLocalFriendsSchema } from '@/lib/friends-schema';
import { requestIdentity } from '@/lib/server-auth';

const isLocal = (request: NextRequest) => ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname);

async function inputForm(request: NextRequest) {
  if (request.headers.get('content-type')?.startsWith('multipart/form-data')) return request.formData();
  const body = await request.json() as { id?: string; type?: string; text?: string };
  const form = new FormData();
  form.set('id', body.id ?? '');
  form.set('category', body.type ?? 'idea');
  form.set('text', body.text ?? '');
  form.set('consent', 'true');
  form.set('route', '/#workspace');
  form.set('viewportWidth', '1');
  form.set('viewportHeight', '1');
  return form;
}

export async function POST(request: NextRequest) {
  await ensureLocalFriendsSchema(env.FRIENDS_DB, isLocal(request));
  const identity = await requestIdentity(request, env, isLocal(request));
  if (!identity) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  if (identity.role !== 'tester') return NextResponse.json({ error: 'tester_session_required' }, { status: 403 });
  if (identity.source === 'friends' && !identity.csrfValid) return NextResponse.json({ error: 'csrf' }, { status: 403 });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 17_000_000) return NextResponse.json({ error: 'request_too_large' }, { status: 413 });
  try {
    const result = await saveFeedback({
      db: env.FRIENDS_DB,
      bucket: env.FRIENDS_AUDIO,
      sessionId: identity.sessionId,
      buildId: env.FRIENDS_BUILD_ID ?? 'local',
      form: await inputForm(request),
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof FeedbackSubmissionError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'feedback_save_failed', message: 'Не удалось сохранить отзыв. Попробуйте ещё раз.' }, { status: 500 });
  }
}
