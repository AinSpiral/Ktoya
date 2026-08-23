import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpStorageAdapter, HttpVoiceProcessingAdapter } from './adapters';
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

describe('HttpVoiceProcessingAdapter', () => {
  it('uses stable provider-independent routes and returns the saved state', async () => {
    const state = createEmptyState();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new HttpVoiceProcessingAdapter();

    await expect(adapter.transcribe('story-1', 'audio-1')).resolves.toEqual(state);
    await expect(adapter.transcribeCaptureDraft('draft-1', 'audio-2')).resolves.toEqual(state);
    await expect(adapter.narrate('story-1')).resolves.toEqual(state);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/voice/transcription', expect.objectContaining({ method: 'POST', body: JSON.stringify({ storyId: 'story-1', audioFragmentId: 'audio-1' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/voice/transcription', expect.objectContaining({ method: 'POST', body: JSON.stringify({ captureDraftId: 'draft-1', audioFragmentId: 'audio-2' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/voice/narration', expect.objectContaining({ method: 'POST', body: JSON.stringify({ storyId: 'story-1' }) }));
  });

  it('surfaces a safe provider blocker instead of pretending the operation worked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'provider_not_configured', message: 'Production STT ещё не подключён. Оригинал аудио сохранён.' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    await expect(new HttpVoiceProcessingAdapter().transcribe('story-1', 'audio-1')).rejects.toThrow('Оригинал аудио сохранён');
  });
});
