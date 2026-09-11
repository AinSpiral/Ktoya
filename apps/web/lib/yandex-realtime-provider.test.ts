import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasFinalRealtimeBilling, runRealtimeVoiceTurn, YandexRealtimeAIProvider, YandexRealtimeError } from './yandex-realtime-provider';
import type { LiveBetaConfig } from './live-beta-config';

const config = {
  apiKey: 'unit-test-key', folderId: 'b1gkl7lo86seu967m35j', model: 'speech-realtime-260528', keyId: 'unit-key',
  keyExpiresAt: '2026-09-14T00:00:00.000Z', capRub: 100, verifiedAt: '2026-09-07T00:00:00.000Z',
  inputAudioRubPerSecond: 0.0264, outputAudioRubPerSecond: 0.0203, inputTextRubPer1kTokens: 0.1, outputTextRubPer1kTokens: 0.2,
} satisfies LiveBetaConfig;

function wav(durationMs = 20) {
  // Generated tone only: never use a person's recording as a regression fixture.
  const pcm = new Uint8Array(durationMs * 32);
  const pcmView = new DataView(pcm.buffer);
  for (let index = 0; index < pcm.length / 2; index += 1) pcmView.setInt16(index * 2, Math.round(8000 * Math.sin(2 * Math.PI * 220 * index / 16_000)), true);
  const result = new Uint8Array(44 + pcm.length);
  const view = new DataView(result.buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => { result[offset + index] = char.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.length, true);
  result.set(pcm, 44);
  return result.buffer;
}

class FakeSocket {
  private listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  sent: Array<Record<string, unknown>> = [];
  closeCalls = 0;
  constructor(private readonly autoAnswer = true) {}
  accept() {}
  close() { this.closeCalls += 1; this.dispatch('close'); }
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }
  get listenerCount() { return [...this.listeners.values()].reduce((total, listeners) => total + listeners.length, 0); }
  dispatch(type: string, data?: string) { this.listeners.get(type)?.slice().forEach((listener) => listener({ data })); }
  message(value: Record<string, unknown>) { this.dispatch('message', JSON.stringify(value)); }
  transcript(value = 'Синтетический рассказ.') { this.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: value }); }
  complete(status = 'completed', inputTokens = 20) {
    this.message({ type: 'response.done', response: { status, usage: { input_tokens: inputTokens, output_tokens: 10 } } });
  }
  send(value: string) {
    const event = JSON.parse(value) as Record<string, unknown>;
    this.sent.push(event);
    if (event.type === 'response.create' && this.autoAnswer) queueMicrotask(() => this.answer(true));
  }
  answer(withTranscript: boolean) {
    const message = (value: Record<string, unknown>) => this.message(value);
    message({ type: 'session.created', session: { id: 'session-unit' } });
    if (withTranscript) message({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Я посадил яблоню.' });
    message({ type: 'response.output_audio_transcript.done', transcript: 'Кто был рядом с вами?' });
    message({ type: 'response.output_audio.delta', delta: btoa(String.fromCharCode(1, 2, 3, 4)) });
    message({ type: 'response.done', response: { status: 'completed', usage: { input_tokens: 20, output_tokens: 10 } } });
  }
}

async function controlledTurn(durationMs = 20) {
  const socket = new FakeSocket(false);
  const fetcher = vi.fn(async () => Object.assign(new Response(null, { status: 200 }), { webSocket: socket }));
  const input = wav(durationMs);
  const promise = runRealtimeVoiceTurn(config, input, durationMs, fetcher as typeof fetch);
  const resolved = vi.fn();
  const rejected = vi.fn();
  // Attach rejection handling before advancing fake time, including failure cases.
  void promise.then(resolved, rejected);
  await vi.advanceTimersByTimeAsync(0);
  socket.message({ type: 'session.created', session: { id: 'session-unit' } });
  return { socket, fetcher, input, promise, resolved, rejected };
}

function expectCleaned(socket: FakeSocket) {
  expect(socket.closeCalls).toBe(1);
  expect(socket.listenerCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
}

describe('Yandex Speech Realtime transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in offline transport tests'); }));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('uses the reviewed endpoint, no-logging header, one commit, and one response request', async () => {
    const socket = new FakeSocket();
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('https://ai.api.cloud.yandex.net/v1/realtime?model=gpt%3A%2F%2Fb1gkl7lo86seu967m35j%2Fspeech-realtime-260528');
      expect(new Headers(init?.headers).get('authorization')).toBe('Api-Key unit-test-key');
      expect(new Headers(init?.headers).get('x-data-logging-enabled')).toBe('false');
      return Object.assign(new Response(null, { status: 200 }), { webSocket: socket });
    };
    const result = await runRealtimeVoiceTurn(config, wav(), 20, fetcher as typeof fetch);
    expect(result).toMatchObject({ transcript: 'Я посадил яблоню.', text: 'Кто был рядом с вами?', providerSessionId: 'session-unit' });
    expect(result.audioPcm).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(socket.sent.filter((event) => event.type === 'input_audio_buffer.commit')).toHaveLength(1);
    expect(socket.sent.filter((event) => event.type === 'response.create')).toHaveLength(1);
  });

  it('fails closed if the provider completes without a transcript', async () => {
    const { socket, promise, resolved, rejected, fetcher } = await controlledTurn();
    socket.complete();
    socket.transcript('  ');
    await vi.advanceTimersByTimeAsync(54_999);
    expect(resolved).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    socket.complete(); // Duplicates cannot restart the deadline.
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toMatchObject({ code: 'provider_empty_content', usage: { inputTokens: 20 }, providerSessionId: 'session-unit' });
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectCleaned(socket);
  });

  it('accepts input transcription completed after response.done', async () => {
    const { socket, promise, resolved, rejected } = await controlledTurn();
    socket.answer(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.closeCalls).toBe(0);
    expect(resolved).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    socket.transcript();
    await expect(promise).resolves.toMatchObject({ transcript: 'Синтетический рассказ.', text: 'Кто был рядом с вами?', audioPcm: new Uint8Array([1, 2, 3, 4]), usage: { inputTokens: 20, outputTokens: 10 } });
    expect(resolved).toHaveBeenCalledTimes(1);
    expectCleaned(socket);
  });

  it('waits for response.done when input transcription arrives first', async () => {
    const { socket, promise, resolved } = await controlledTurn();
    socket.transcript();
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).not.toHaveBeenCalled();
    expect(socket.closeCalls).toBe(0);
    socket.complete();
    await expect(promise).resolves.toMatchObject({ transcript: 'Синтетический рассказ.' });
    expectCleaned(socket);
  });

  it.each([false, true])('times out without response.done (transcript present: %s)', async (withTranscript) => {
    const { socket, promise } = await controlledTurn();
    if (withTranscript) socket.transcript();
    await vi.advanceTimersByTimeAsync(55_000);
    await expect(promise).rejects.toMatchObject({ code: 'provider_timeout' });
    expectCleaned(socket);
  });

  it.each(['error', 'conversation.item.input_audio_transcription.failed', 'failed-response', 'cancelled-response', 'socket-error', 'socket-close', 'invalid-json'].flatMap((terminal) => [false, true].map((completed) => ({ terminal, completed }))))('fails once on $terminal (response completed: $completed)', async ({ terminal, completed }) => {
    const { socket, promise, resolved, rejected } = await controlledTurn();
    if (completed) socket.complete();
    if (terminal === 'failed-response') socket.complete('failed');
    else if (terminal === 'cancelled-response') socket.complete('cancelled');
    else if (terminal === 'socket-error') socket.dispatch('error');
    else if (terminal === 'socket-close') socket.dispatch('close');
    else if (terminal === 'invalid-json') socket.dispatch('message', '{');
    else socket.message({ type: terminal });
    await expect(promise).rejects.toMatchObject({ code: 'provider_protocol' });
    socket.transcript();
    socket.complete();
    await vi.advanceTimersByTimeAsync(55_000);
    expect(resolved).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledTimes(1);
    expectCleaned(socket);
  });

  it('cleans up once if sending the request throws', async () => {
    const socket = new FakeSocket(false);
    socket.send = () => { throw new Error('synthetic send failure'); };
    const fetcher = vi.fn(async () => Object.assign(new Response(null, { status: 200 }), { webSocket: socket }));
    await expect(runRealtimeVoiceTurn(config, wav(), 20, fetcher as typeof fetch)).rejects.toMatchObject({ code: 'provider_protocol' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectCleaned(socket);
  });

  it.each([true, false])('keeps text-only completion independent of input transcription (text present: %s)', async (withText) => {
    const socket = new FakeSocket(false);
    const fetcher = vi.fn(async () => Object.assign(new Response(null, { status: 200 }), { webSocket: socket }));
    const db = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue({ user_id: 'qa-user', kind: 'interview-next', status: 'reserved' }) })) })) } as unknown as D1Database;
    const provider = new YandexRealtimeAIProvider(config, { db, userId: 'qa-user', operationId: 'qa-op' }, fetcher as typeof fetch);
    const promise = provider.nextInterviewStep({ storyId: 'qa-story', sources: [{ id: 'source-1', kind: 'typed', text: 'Синтетический рассказ.' }], askedQuestions: [] });
    void promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const text = JSON.stringify({ decision: 'ASK', question: 'Какая деталь запомнилась?', anchorQuote: 'Синтетический рассказ', category: 'detail', purpose: 'Уточнить деталь', relatedSourceIds: ['source-1'], reason: '' });
    socket.message({ type: 'response.done', response: { status: 'completed', output: withText ? [{ content: [{ type: 'output_text', text }] }] : [] } });
    if (withText) await expect(promise).resolves.toMatchObject({ value: { decision: 'ASK' } });
    else await expect(promise).rejects.toMatchObject({ code: 'provider_empty_content' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectCleaned(socket);
  });

  it('ignores duplicate completion and late output without changing final usage or result', async () => {
    const { socket, promise, resolved, rejected } = await controlledTurn();
    socket.answer(false);
    socket.complete('completed', 999);
    socket.message({ type: 'response.output_audio.delta', delta: btoa('late') });
    socket.message({ type: 'response.output_text.delta', delta: 'late' });
    socket.transcript();
    const result = await promise;
    socket.complete('failed');
    socket.message({ type: 'error' });
    socket.transcript('late duplicate');
    await vi.advanceTimersByTimeAsync(55_000);
    expect(result).toMatchObject({ transcript: 'Синтетический рассказ.', text: 'Кто был рядом с вами?', audioPcm: new Uint8Array([1, 2, 3, 4]), usage: { inputTokens: 20, outputTokens: 10 } });
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(rejected).not.toHaveBeenCalled();
    expectCleaned(socket);
  });

  it.each(['transcript-first', 'response-first'])('preserves all synthetic 105.78-second PCM in %s order with one request and no retry', async (order) => {
    const { socket, promise, input, fetcher } = await controlledTurn(105_780);
    const appended = socket.sent.filter((event) => event.type === 'input_audio_buffer.append');
    const buffers = appended.map((event) => Buffer.from(String(event.audio), 'base64'));
    const sentPcm = Buffer.concat(buffers);
    expect(appended).toHaveLength(106);
    expect(buffers.slice(0, -1).every((chunk) => chunk.byteLength === 32_000)).toBe(true);
    expect(buffers.at(-1)?.byteLength).toBe(24_960);
    expect(sentPcm.byteLength).toBe(3_384_960);
    expect(sentPcm.some((byte) => byte !== 0)).toBe(true);
    expect(createHash('sha256').update(sentPcm).digest('hex')).toBe(createHash('sha256').update(new Uint8Array(input, 44)).digest('hex'));
    expect(socket.sent[0]).toMatchObject({ type: 'session.update', session: { audio: { input: { format: { type: 'audio/pcm', rate: 16_000 }, turn_detection: null } } } });
    expect(socket.sent.slice(-2).map((event) => event.type)).toEqual(['input_audio_buffer.commit', 'response.create']);
    expect(socket.sent.filter((event) => event.type === 'input_audio_buffer.commit')).toHaveLength(1);
    expect(socket.sent.filter((event) => event.type === 'response.create')).toHaveLength(1);
    if (order === 'transcript-first') socket.transcript();
    socket.complete();
    if (order === 'response-first') {
      await vi.advanceTimersByTimeAsync(2000);
      expect(socket.closeCalls).toBe(0);
      socket.transcript();
    }
    await expect(promise).resolves.toMatchObject({ transcript: 'Синтетический рассказ.', usage: { inputAudioMs: 105_780 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectCleaned(socket);
  });

  it('distinguishes final post-response errors from ambiguous transport failures', () => {
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_invalid_json', { inputTokens: 1 }))).toBe(true);
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_empty_content', { inputAudioMs: 1000 }))).toBe(true);
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_timeout', { inputAudioMs: 1000 }))).toBe(false);
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_protocol', { outputAudioMs: 31_000 }))).toBe(false);
  });
});
