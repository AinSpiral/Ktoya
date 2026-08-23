export function authenticatedUserId(headers: Headers, allowLocalDevelopmentIdentity = false): string | null {
  const platformIdentity = headers.get('oai-authenticated-user-id') ?? headers.get('oai-authenticated-user-email');
  if (platformIdentity) return platformIdentity;
  if (!allowLocalDevelopmentIdentity) return null;
  return headers.get('x-ktoya-dev-user') ?? 'local-development-author';
}
