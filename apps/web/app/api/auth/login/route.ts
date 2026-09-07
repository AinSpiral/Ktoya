import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { anonymizedActorKey, createFriendsSession, csrfCookie, matchTesterAccount, secretMatches, sessionCookie, testerAccounts, type FriendsRole } from '@/lib/friends-auth';
import { FRIENDS_BETA_LIMITS } from '@/lib/friends-limits';
import { ensureLocalFriendsSchema } from '@/lib/friends-schema';

function isLocal(request: NextRequest) {
  return request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1';
}

export async function POST(request: NextRequest) {
  await ensureLocalFriendsSchema(env.FRIENDS_DB, isLocal(request));
  if (!env.FRIENDS_SESSION_SECRET || !env.OWNER_ACCESS_CODE || testerAccounts(env.FRIENDS_TESTER_ACCESS_CODES).length < 3) {
    return NextResponse.json({ error: 'access_not_configured' }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as { code?: string; role?: FriendsRole } | null;
  const role = body?.role === 'owner' ? 'owner' : 'tester';
  const code = body?.code?.trim() ?? '';
  const now = Date.now();
  const windowKey = String(Math.floor(now / FRIENDS_BETA_LIMITS.loginWindowMs));
  const actorKey = await anonymizedActorKey(request, env.FRIENDS_SESSION_SECRET, windowKey);
  const attempts = await env.FRIENDS_DB.prepare(
    'SELECT attempts FROM friends_login_attempts WHERE actor_key = ? AND window_key = ?',
  ).bind(actorKey, windowKey).first<{ attempts: number }>();
  if ((attempts?.attempts ?? 0) >= FRIENDS_BETA_LIMITS.loginAttemptsPerWindow) {
    return NextResponse.json({ error: 'too_many_attempts' }, { status: 429, headers: { 'retry-after': '900' } });
  }

  const accountId = role === 'tester' ? await matchTesterAccount(code, env.FRIENDS_TESTER_ACCESS_CODES, env.FRIENDS_SESSION_SECRET) : null;
  const accepted = role === 'owner' ? Boolean(code && await secretMatches(code, env.OWNER_ACCESS_CODE, env.FRIENDS_SESSION_SECRET)) : Boolean(accountId);
  if (!accepted) {
    const iso = new Date(now).toISOString();
    await env.FRIENDS_DB.prepare(`INSERT INTO friends_login_attempts (actor_key, window_key, attempts, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(actor_key, window_key) DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at`)
      .bind(actorKey, windowKey, iso).run();
    return NextResponse.json({ error: 'invalid_access_code' }, { status: 401 });
  }

  const created = await createFriendsSession(role, env.FRIENDS_SESSION_SECRET, now, accountId ?? undefined);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(created.payload.exp).toISOString();
  await env.FRIENDS_DB.prepare('INSERT INTO friends_sessions (session_id, role, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(created.payload.sid, role, accountId, createdAt, expiresAt).run();
  const response = NextResponse.json({ ok: true, role, expiresAt });
  response.headers.append('set-cookie', sessionCookie(created.token, created.ttl));
  response.headers.append('set-cookie', csrfCookie(created.payload.csrf, created.ttl));
  response.headers.set('cache-control', 'no-store');
  return response;
}
