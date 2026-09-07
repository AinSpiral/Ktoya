import { sessionFromRequest, validCsrf, type FriendsRole } from './friends-auth';

export function authenticatedUserId(headers: Headers, allowLocalDevelopmentIdentity = false): string | null {
  const platformIdentity = headers.get('oai-authenticated-user-id') ?? headers.get('oai-authenticated-user-email');
  if (platformIdentity) return platformIdentity;
  if (!allowLocalDevelopmentIdentity) return null;
  return headers.get('x-ktoya-dev-user') ?? 'local-development-author';
}

export type RequestIdentity = {
  userId: string;
  role: FriendsRole;
  source: 'friends' | 'platform' | 'local';
  sessionId: string;
  accountId?: string;
  csrfValid: boolean;
};

/** Stable invited-account storage namespace; legacy sessions keep their original namespace. */
export function identityStorageOwner(identity: RequestIdentity) {
  return identity.accountId ? `account_${identity.accountId}` : identity.sessionId;
}

export async function requestIdentity(request: Request, env: Env, allowLocalDevelopmentIdentity = false): Promise<RequestIdentity | null> {
  const hostname = new URL(request.url).hostname;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  // A public Worker has no authenticated upstream contract for these headers:
  // callers can set them themselves. Friends Beta therefore accepts the
  // compatibility identity only outside Friends mode or on an explicit local
  // development origin.
  const allowPlatformIdentity = env.FRIENDS_BETA_MODE !== 'true' || isLocalHost;
  const platformIdentity = allowPlatformIdentity ? authenticatedUserId(request.headers, false) : null;
  if (platformIdentity) return { userId: platformIdentity, role: 'tester', source: 'platform', sessionId: platformIdentity, csrfValid: true };
  const session = await sessionFromRequest(request, env);
  if (session) {
    return {
      userId: session.accountId ? `friends-account:${session.accountId}` : `friends:${session.sid}`,
      role: session.role,
      source: 'friends',
      sessionId: session.sid,
      accountId: session.accountId,
      csrfValid: validCsrf(request, session),
    };
  }
  if (allowLocalDevelopmentIdentity && isLocalHost) {
    const local = authenticatedUserId(request.headers, true)!;
    return { userId: local, role: 'tester', source: 'local', sessionId: local, csrfValid: true };
  }
  return null;
}
