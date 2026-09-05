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
  csrfValid: boolean;
};

export async function requestIdentity(request: Request, env: Env, allowLocalDevelopmentIdentity = false): Promise<RequestIdentity | null> {
  const platformIdentity = authenticatedUserId(request.headers, false);
  if (platformIdentity) return { userId: platformIdentity, role: 'tester', source: 'platform', sessionId: platformIdentity, csrfValid: true };
  const session = await sessionFromRequest(request, env);
  if (session) {
    return {
      userId: `friends:${session.sid}`,
      role: session.role,
      source: 'friends',
      sessionId: session.sid,
      csrfValid: validCsrf(request, session),
    };
  }
  const hostname = new URL(request.url).hostname;
  if (allowLocalDevelopmentIdentity && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    const local = authenticatedUserId(request.headers, true)!;
    return { userId: local, role: 'tester', source: 'local', sessionId: local, csrfValid: true };
  }
  return null;
}
