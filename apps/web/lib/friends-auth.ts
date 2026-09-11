import { FRIENDS_BETA_LIMITS } from './friends-limits';

export type FriendsRole = 'tester' | 'owner';
export type FriendsSession = {
  sid: string;
  role: FriendsRole;
  accountId?: string;
  csrf: string;
  exp: number;
};

const SESSION_COOKIE = 'ktoya_fb_session';
const CSRF_COOKIE = 'ktoya_fb_csrf';

function base64url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function secretMatches(actual: string, expected: string, signingSecret: string) {
  const [left, right] = await Promise.all([hmac(signingSecret, actual), hmac(signingSecret, expected)]);
  return equalBytes(left, right);
}

export async function createFriendsSession(role: FriendsRole, secret: string, now = Date.now(), accountId?: string) {
  const ttl = role === 'owner' ? FRIENDS_BETA_LIMITS.ownerSessionTtlSeconds : FRIENDS_BETA_LIMITS.testerSessionTtlSeconds;
  const payload: FriendsSession = {
    sid: crypto.randomUUID(),
    role,
    ...(role === 'tester' && accountId ? { accountId } : {}),
    csrf: base64url(crypto.getRandomValues(new Uint8Array(24))),
    exp: now + ttl * 1_000,
  };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64url(await hmac(secret, encoded));
  return { payload, token: `${encoded}.${signature}`, ttl };
}

export async function verifyFriendsSession(token: string | null, secret: string | undefined, now = Date.now()): Promise<FriendsSession | null> {
  if (!token || !secret || secret.length < 32) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  let supplied: Uint8Array;
  try { supplied = fromBase64url(signature); } catch { return null; }
  const expected = await hmac(secret, encoded);
  if (!equalBytes(supplied, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(encoded))) as FriendsSession;
    if (!payload.sid || !/^[0-9a-f-]{36}$/i.test(payload.sid) || !['tester', 'owner'].includes(payload.role) || !payload.csrf || payload.exp <= now) return null;
    if (payload.accountId && !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(payload.accountId)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function testerAccounts(value: string | undefined) {
  if (!value) return [] as Array<{ accountId: string; code: string }>;
  try {
    const decoded = JSON.parse(value) as Record<string, unknown>;
    const entries = Object.entries(decoded).filter(([accountId, code]) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(accountId) && typeof code === 'string' && code.length >= 12 && code.length <= 128)
      .map(([accountId, code]) => ({ accountId, code: code as string }));
    return entries.length >= 3 && entries.length <= 4 ? entries : [];
  } catch { return [] as Array<{ accountId: string; code: string }>; }
}

export async function matchTesterAccount(code: string, encodedAccounts: string | undefined, signingSecret: string) {
  const accounts = testerAccounts(encodedAccounts);
  if (!accounts.length || !code) return null;
  const matches = await Promise.all(accounts.map(async (account) => ({ accountId: account.accountId, matches: await secretMatches(code, account.code, signingSecret) })));
  return matches.find((item) => item.matches)?.accountId ?? null;
}

export function cookieValue(headers: Headers, name: string) {
  const cookie = headers.get('cookie') ?? '';
  for (const item of cookie.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export async function sessionFromRequest(request: Request, env: Pick<Env, 'FRIENDS_SESSION_SECRET'>) {
  return verifyFriendsSession(cookieValue(request.headers, SESSION_COOKIE), env.FRIENDS_SESSION_SECRET);
}

export function sessionCookie(token: string, ttlSeconds: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttlSeconds}`;
}

export function csrfCookie(csrf: string, ttlSeconds: number) {
  return `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; Path=/; Secure; SameSite=Strict; Max-Age=${ttlSeconds}`;
}

export function clearSessionCookies() {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`,
  ];
}

export function validCsrf(request: Request, session: FriendsSession) {
  const header = request.headers.get('x-ktoya-csrf');
  const origin = request.headers.get('origin');
  const expectedOrigin = new URL(request.url).origin;
  return Boolean(header && header === session.csrf && origin === expectedOrigin);
}

export async function anonymizedActorKey(request: Request, secret: string, windowKey: string) {
  const address = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ?? 'unknown';
  return base64url(await hmac(secret, `${windowKey}:${address}`)).slice(0, 32);
}
