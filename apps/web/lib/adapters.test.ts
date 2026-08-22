import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpStorageAdapter } from './adapters';
import { createEmptyState } from './domain';

afterEach(() => vi.unstubAllGlobals());

describe('HttpStorageAdapter', () => {
  it('treats a missing server record as a new book', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(new HttpStorageAdapter().load()).resolves.toBeNull();
  });

  it('persists the full book state through the private API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const state = createEmptyState();
    await new HttpStorageAdapter().save(state);
    expect(fetchMock).toHaveBeenCalledWith('/api/state', expect.objectContaining({ method: 'PUT', body: JSON.stringify(state) }));
  });
});
