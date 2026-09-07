import { describe, expect, it } from 'vitest';
import { hasFinalRealtimeBilling, runRealtimeVoiceTurn, YandexRealtimeError } from './yandex-realtime-provider';
import type { LiveBetaConfig } from './live-beta-config';

const config = {
  apiKey: 'unit-test-key', folderId: 'b1gkl7lo86seu967m35j', model: 'speech-realtime-260528', keyId: 'unit-key',
  keyExpiresAt: '2026-09-14T00:00:00.000Z', capRub: 100, verifiedAt: '2026-09-07T00:00:00.000Z',
  inputAudioRubPerSecond: 0.0264, outputAudioRubPerSecond: 0.0203, inputTextRubPer1kTokens: 0.1, outputTextRubPer1kTokens: 0.2,
} satisfies LiveBetaConfig;

function wav() {
  const pcm = new Uint8Array(640);
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
  accept() {}
  close() {}
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(value: string) {
    const event = JSON.parse(value) as Record<string, unknown>;
    this.sent.push(event);
    if (event.type === 'response.create') queueMicrotask(() => this.answer(true));
  }
  answer(withTranscript: boolean) {
    const message = (value: Record<string, unknown>) => this.listeners.get('message')?.forEach((listener) => listener({ data: JSON.stringify(value) }));
    message({ type: 'session.created', session: { id: 'session-unit' } });
    if (withTranscript) message({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Я посадил яблоню.' });
    message({ type: 'response.output_audio_transcript.done', transcript: 'Кто был рядом с вами?' });
    message({ type: 'response.output_audio.delta', delta: btoa(String.fromCharCode(1, 2, 3, 4)) });
    message({ type: 'response.done', response: { status: 'completed', usage: { input_tokens: 20, output_tokens: 10 } } });
  }
}

describe('Yandex Speech Realtime transport', () => {
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
    const socket = new FakeSocket();
    socket.send = function(value: string) {
      const event = JSON.parse(value) as Record<string, unknown>;
      this.sent.push(event);
      if (event.type === 'response.create') queueMicrotask(() => this.answer(false));
    };
    const fetcher = async () => Object.assign(new Response(null, { status: 200 }), { webSocket: socket });
    await expect(runRealtimeVoiceTurn(config, wav(), 20, fetcher as typeof fetch)).rejects.toMatchObject({ code: 'provider_empty_content' });
  });

  it('distinguishes final post-response errors from ambiguous transport failures', () => {
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_invalid_json', { inputTokens: 1 }))).toBe(true);
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_empty_content', { inputAudioMs: 1000 }))).toBe(true);
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_timeout', { inputAudioMs: 1000 }))).toBe(false);
    expect(hasFinalRealtimeBilling(new YandexRealtimeError('provider_protocol', { outputAudioMs: 31_000 }))).toBe(false);
  });
});
