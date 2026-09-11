import { describe, expect, it } from 'vitest';
import { createFriendsSession } from './friends-auth';
import { authenticatedUserId, requestIdentity } from './server-auth';

const secret = 'friends-session-secret-longer-than-32-characters';
const friendsEnv = { FRIENDS_BETA_MODE: 'true', FRIENDS_SESSION_SECRET: secret } as Env;

describe('production identity boundary', () => {
  it('does not create a shared local fallback identity', () => {
    expect(authenticatedUserId(new Headers())).toBeNull();
  });

  it('uses only an authenticated platform identity', () => {
    expect(authenticatedUserId(new Headers({ 'oai-authenticated-user-id': 'author-1' }))).toBe('author-1');
  });

  it('allows an explicit development identity only when the server opts in', () => {
    const headers = new Headers({ 'x-ktoya-dev-user': 'local-author' });
    expect(authenticatedUserId(headers)).toBeNull();
    expect(authenticatedUserId(headers, true)).toBe('local-author');
    expect(authenticatedUserId(new Headers(), true)).toBe('local-development-author');
  });

  it('rejects caller-supplied platform identity headers on the public Friends Beta', async () => {
    const request = new Request('https://friends.example/api/friends/state', {
      headers: { 'oai-authenticated-user-id': 'forged-author' },
    });
    await expect(requestIdentity(request, friendsEnv, false)).resolves.toBeNull();
  });

  it('still accepts a signed Friends session on the public Friends Beta', async () => {
    const session = await createFriendsSession('tester', secret);
    const request = new Request('https://friends.example/api/friends/state', {
      headers: { cookie: `ktoya_fb_session=${encodeURIComponent(session.token)}` },
    });
    await expect(requestIdentity(request, friendsEnv, false)).resolves.toMatchObject({
      role: 'tester', source: 'friends', sessionId: session.payload.sid,
    });
  });

  it('keeps the platform compatibility identity limited to non-Friends or localhost contexts', async () => {
    const publicLegacy = new Request('https://legacy.example/api/state', { headers: { 'oai-authenticated-user-id': 'author-1' } });
    await expect(requestIdentity(publicLegacy, { FRIENDS_BETA_MODE: 'false' } as Env, false)).resolves.toMatchObject({ source: 'platform' });
    const localFriends = new Request('http://127.0.0.1/api/state', { headers: { 'oai-authenticated-user-id': 'author-1' } });
    await expect(requestIdentity(localFriends, friendsEnv, true)).resolves.toMatchObject({ source: 'platform' });
  });
});
