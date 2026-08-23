import { describe, expect, it } from 'vitest';
import { assertExpectedVersion } from './concurrency';

describe('optimistic concurrency', () => {
  it('rejects a stale second writer instead of silently overwriting the first', () => {
    expect(() => assertExpectedVersion(3, 4, 'story')).toThrow('story: conflict');
  });

  it('accepts the exact version read by the writer', () => {
    expect(() => assertExpectedVersion(4, 4, 'story')).not.toThrow();
  });
});
