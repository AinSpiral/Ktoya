import { describe, expect, it } from 'vitest';
import {
  clearSessionCookies,
  createFriendsSession,
  csrfCookie,
  sessionCookie,
  validCsrf,
  verifyFriendsSession,
} from './friends-auth';
import { FRIENDS_BETA_LIMITS } from './friends-limits';

const secret = 'friends-beta-test-secret-with-more-than-32-characters';

describe('Friends Beta signed sessions', () => {
  it('round-trips an unexpired signed tester session and rejects tampering', async () => {
    const now = Date.UTC(2026, 8, 5);
    const created = await createFriendsSession('tester', secret, now);
    expect(created.ttl).toBe(FRIENDS_BETA_LIMITS.testerSessionTtlSeconds);
    await expect(verifyFriendsSession(created.token, secret, now + 1_000)).resolves.toEqual(created.payload);
    const tampered = `${created.token.slice(0, -1)}${created.token.endsWith('a') ? 'b' : 'a'}`;
    await expect(verifyFriendsSession(tampered, secret, now + 1_000)).resolves.toBeNull();
  });

  it('uses a shorter owner TTL and rejects expired sessions', async () => {
    const now = Date.UTC(2026, 8, 5);
    const created = await createFriendsSession('owner', secret, now);
    expect(created.ttl).toBe(FRIENDS_BETA_LIMITS.ownerSessionTtlSeconds);
    await expect(verifyFriendsSession(created.token, secret, created.payload.exp)).resolves.toBeNull();
  });

  it('requires both same-origin and the session CSRF value', async () => {
    const created = await createFriendsSession('tester', secret);
    const request = new Request('https://friends.example/api/friends/state', {
      method: 'PUT',
      headers: { origin: 'https://friends.example', 'x-ktoya-csrf': created.payload.csrf },
    });
    expect(validCsrf(request, created.payload)).toBe(true);
    expect(validCsrf(new Request(request, { headers: { origin: 'https://evil.example', 'x-ktoya-csrf': created.payload.csrf } }), created.payload)).toBe(false);
  });

  it('sets secure cookie attributes and clears both cookies', async () => {
    const created = await createFriendsSession('tester', secret);
    expect(sessionCookie(created.token, created.ttl)).toContain('HttpOnly; Secure; SameSite=Strict');
    expect(csrfCookie(created.payload.csrf, created.ttl)).toContain('Secure; SameSite=Strict');
    expect(clearSessionCookies()).toHaveLength(2);
    expect(clearSessionCookies().every((value) => value.includes('Max-Age=0'))).toBe(true);
  });
});
