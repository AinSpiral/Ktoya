import { describe, expect, it } from 'vitest';
import { authenticatedUserId } from './server-auth';

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
});
