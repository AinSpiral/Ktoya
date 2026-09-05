import { describe, expect, it } from 'vitest';
import { countPendingMediaReferences, FRIENDS_STATE_LIMITS, utf8ByteLength } from './friends-state-limits';

describe('Friends state recovery limits', () => {
  it('counts only pending fragments without a stored object key', () => {
    const state = {
      captureDrafts: [{
        storyFragments: [
          { fragment: { uploadStatus: 'pending' } },
          { fragment: { uploadStatus: 'pending', objectKey: 'already/saved.webm' } },
          { fragment: { uploadStatus: 'saved' } },
        ],
      }],
    };
    expect(countPendingMediaReferences(state)).toBe(1);
  });

  it('stops once the server-side pending-media ceiling is exceeded', () => {
    const fragments = Array.from({ length: FRIENDS_STATE_LIMITS.maxPendingMediaReferences + 5 }, () => ({ fragment: { uploadStatus: 'pending' } }));
    expect(countPendingMediaReferences({ fragments })).toBe(FRIENDS_STATE_LIMITS.maxPendingMediaReferences + 1);
  });

  it('measures UTF-8 bytes rather than JavaScript character count', () => {
    expect(utf8ByteLength('КтоЯ')).toBeGreaterThan('КтоЯ'.length);
  });
});
