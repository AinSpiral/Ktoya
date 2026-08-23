import { describe, expect, it, vi } from 'vitest';
import { YandexSpeechKitTranscriptionProvider, YandexSpeechKitTTSProvider } from './speechkit-provider';

function authorizedDb(status: 'reserved' | 'submitted' = 'reserved', externalJobId: string | null = null, kind: 'stt' | 'tts' = 'stt') {
  const row = { operation_id: 'operation-qa-1', user_id: 'user-qa', kind, source_id: 'derived-qa-1', qa_nonpersonal: 1, max_cost_microrub: 151500, status, external_job_id: externalJobId };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(row) })) })) } as unknown as D1Database;
}

describe('Yandex SpeechKit provider contract', () => {
  it('sends only supported derived audio and keeps literatureText disabled by default', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'speechkit-job-1', done: false }), { status: 200 }));
    const provider = new YandexSpeechKitTranscriptionProvider('hidden-key', { db: authorizedDb(), userId: 'user-qa', operationId: 'operation-qa-1', sourceId: 'derived-qa-1' }, fetcher);
    const result = await provider.submit({ audio: new Uint8Array([1, 2, 3]).buffer, contentType: 'audio/wav', language: 'ru-RU' });
    expect(result).toEqual({ status: 'processing', externalJobId: 'speechkit-job-1' });
    const request = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(request.recognitionModel.audioFormat.containerAudio.containerAudioType).toBe('WAV');
    expect(request.recognitionModel.textNormalization.literatureText).toBe(false);
    expect(JSON.stringify(request)).not.toContain('hidden-key');
  });

  it('rejects a browser WebM original before any SpeechKit fetch', async () => {
    const fetcher = vi.fn();
    const provider = new YandexSpeechKitTranscriptionProvider('hidden-key', { db: authorizedDb(), userId: 'user-qa', operationId: 'operation-qa-1', sourceId: 'derived-qa-1' }, fetcher);
    await expect(provider.submit({ audio: new ArrayBuffer(1), contentType: 'audio/webm', language: 'ru-RU' })).rejects.toThrow('derived WAV');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('collects all beginning, middle and end STT refinements without truncation', async () => {
    const operation = new Response(JSON.stringify({ done: true }), { status: 200 });
    const transcript = [
      { result: { finalRefinement: { finalIndex: '0', normalizedText: { alternatives: [{ text: 'Начало контрольной записи.' }] } } } },
      { result: { finalRefinement: { finalIndex: '1', normalizedText: { alternatives: [{ text: 'Середина содержит дату 23 августа 2026 года.' }] } } } },
      { result: { finalRefinement: { finalIndex: '2', normalizedText: { alternatives: [{ text: 'Конец контрольной записи.' }] } } } },
    ].map((item) => JSON.stringify(item)).join('\n');
    const fetcher = vi.fn().mockResolvedValueOnce(operation).mockResolvedValueOnce(new Response(transcript, { status: 200 }));
    const db = authorizedDb('submitted', 'speechkit-job-1');
    const provider = new YandexSpeechKitTranscriptionProvider('hidden-key', { db, userId: 'user-qa', operationId: 'operation-qa-1', sourceId: 'derived-qa-1' }, fetcher);
    await expect(provider.poll('speechkit-job-1')).resolves.toEqual({ status: 'ready', value: { text: 'Начало контрольной записи. Середина содержит дату 23 августа 2026 года. Конец контрольной записи.' } });
  });

  it('concatenates all TTS chunks into one seekable OGG asset for the requested voice', async () => {
    const payload = [
      { result: { audioChunk: { data: btoa('ab') }, startMs: '0', lengthMs: '1000' } },
      { result: { audioChunk: { data: btoa('cd') }, startMs: '1000', lengthMs: '900' } },
    ].map((item) => JSON.stringify(item)).join('\n');
    const fetcher = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    const provider = new YandexSpeechKitTTSProvider('hidden-key', { db: authorizedDb('reserved', null, 'tts'), userId: 'user-qa', operationId: 'operation-qa-1', sourceId: 'derived-qa-1' }, fetcher);
    const result = await provider.submit({ text: 'Достаточно длинный неперсональный тестовый текст.', language: 'ru-RU', voiceId: 'marina' });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(new TextDecoder().decode(result.value.audio)).toBe('abcd');
      expect(result.value).toMatchObject({ contentType: 'audio/ogg', durationMs: 1900, voiceId: 'marina' });
    }
  });

  it('rejects a missing or unapproved TTS voice before any external provider request', async () => {
    const fetcher = vi.fn();
    const provider = new YandexSpeechKitTTSProvider('hidden-key', { db: authorizedDb('reserved', null, 'tts'), userId: 'user-qa', operationId: 'operation-qa-1', sourceId: 'derived-qa-1' }, fetcher);
    const baseInput = { text: 'Неперсональный тестовый текст.', language: 'ru-RU' as const };
    await expect(provider.submit(baseInput as { text: string; language: 'ru-RU'; voiceId: string })).rejects.toThrow('explicitly approved voiceId');
    await expect(provider.submit({ ...baseInput, voiceId: 'unapproved-voice' })).rejects.toThrow('explicitly approved voiceId');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
