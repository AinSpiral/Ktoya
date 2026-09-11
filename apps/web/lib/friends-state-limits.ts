export const FRIENDS_STATE_LIMITS = {
  maxBodyBytes: 5_000_000,
  maxPendingMediaReferences: 1_000,
} as const;

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function countPendingMediaReferences(value: unknown, stopAfter = FRIENDS_STATE_LIMITS.maxPendingMediaReferences + 1) {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length && count < stopAfter) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    const fragment = record.fragment;
    if (fragment && typeof fragment === 'object') {
      const candidate = fragment as Record<string, unknown>;
      if (candidate.uploadStatus === 'pending' && !candidate.objectKey) count += 1;
    }
    stack.push(...Object.values(record));
  }
  return count;
}
