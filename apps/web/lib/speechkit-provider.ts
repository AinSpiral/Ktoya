import type { ProviderJobResult, TranscriptionProvider, TTSProvider } from './adapters';
import { requireReservedTrialOperation, requireSubmittedTrialOperation } from './voice-trial-budget';

const STT_BASE = 'https://stt.api.cloud.yandex.net';
const TTS_BASE = 'https://tts.api.cloud.yandex.net';
const OPERATION_BASE = 'https://operation.api.cloud.yandex.net';

interface AuthorizedProviderContext {
  db: D1Database;
  userId: string;
  operationId: string;
  sourceId: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function containerFor(contentType: string) {
  if (contentType === 'audio/wav' || contentType === 'audio/x-wav') return 'WAV';
  if (contentType === 'audio/ogg' || contentType === 'audio/opus') return 'OGG_OPUS';
  if (contentType === 'audio/mpeg' || contentType === 'audio/mp3') return 'MP3';
  throw new Error('SpeechKit input must be a preserved derived WAV, OGG/Opus, or MP3 asset.');
}

async function providerJson(response: Response) {
  if (!response.ok) throw new Error(`SpeechKit request failed with HTTP ${response.status}.`);
  return response.json() as Promise<Record<string, unknown>>;
}

function resultObjects(payload: string): Array<Record<string, unknown>> {
  return payload.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function responseResult(item: Record<string, unknown>) {
  return (item.result && typeof item.result === 'object' ? item.result : item) as Record<string, unknown>;
}

export class YandexSpeechKitTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'yandex-speechkit-v3';
  constructor(private readonly apiKey: string, private readonly authorization: AuthorizedProviderContext, private readonly fetcher: typeof fetch = fetch) {}
  private headers() { return { authorization: `Api-Key ${this.apiKey}`, 'content-type': 'application/json' }; }

  async submit(input: { audio: ArrayBuffer; contentType: string; language: 'ru-RU'; literatureText?: boolean }): Promise<ProviderJobResult<{ text: string }>> {
    await requireReservedTrialOperation({ ...this.authorization, kind: 'stt' });
    const containerAudioType = containerFor(input.contentType);
    const response = await this.fetcher(`${STT_BASE}/stt/v3/recognizeFileAsync`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({
        content: arrayBufferToBase64(input.audio),
        recognitionModel: {
          model: 'general',
          audioFormat: { containerAudio: { containerAudioType } },
          textNormalization: { textNormalization: 'TEXT_NORMALIZATION_ENABLED', literatureText: input.literatureText === true },
          languageRestriction: { restrictionType: 'WHITELIST', languageCode: [input.language] },
        },
      }),
    });
    const operation = await providerJson(response) as { id?: string };
    if (!operation.id) throw new Error('SpeechKit did not return an operation id.');
    return { status: 'processing', externalJobId: operation.id };
  }

  async poll(externalJobId: string): Promise<ProviderJobResult<{ text: string }>> {
    await requireSubmittedTrialOperation({ ...this.authorization, kind: 'stt', externalJobId });
    const operation = await providerJson(await this.fetcher(`${OPERATION_BASE}/operations/${encodeURIComponent(externalJobId)}`, { headers: this.headers() })) as { done?: boolean; error?: unknown };
    if (!operation.done) return { status: 'processing', externalJobId };
    if (operation.error) throw new Error('SpeechKit recognition operation failed.');
    const response = await this.fetcher(`${STT_BASE}/stt/v3/getRecognition?operation_id=${encodeURIComponent(externalJobId)}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`SpeechKit recognition result failed with HTTP ${response.status}.`);
    const items = resultObjects(await response.text()).map(responseResult);
    const refined = new Map<string, string>();
    const finals = new Map<string, string>();
    for (const item of items) {
      const refinement = item.finalRefinement as { finalIndex?: string; normalizedText?: { alternatives?: Array<{ text?: string }> } } | undefined;
      const final = item.final as { alternatives?: Array<{ text?: string }> } | undefined;
      if (refinement?.normalizedText?.alternatives?.[0]?.text) refined.set(refinement.finalIndex ?? String(refined.size), refinement.normalizedText.alternatives[0].text);
      if (final?.alternatives?.[0]?.text) finals.set(String(finals.size), final.alternatives[0].text);
    }
    const text = [...(refined.size ? refined : finals).values()].join(' ').trim();
    if (!text) throw new Error('SpeechKit returned no transcript text.');
    return { status: 'ready', value: { text } };
  }
}

export class YandexSpeechKitTTSProvider implements TTSProvider {
  readonly id = 'yandex-speechkit-v3';
  constructor(private readonly apiKey: string, private readonly authorization: AuthorizedProviderContext, private readonly fetcher: typeof fetch = fetch) {}

  async submit(input: { text: string; language: 'ru-RU'; voiceId?: string }): Promise<ProviderJobResult<{ audio: ArrayBuffer; contentType: string; durationMs?: number; voiceId?: string }>> {
    await requireReservedTrialOperation({ ...this.authorization, kind: 'tts' });
    const voiceId = input.voiceId ?? 'marina';
    const response = await this.fetcher(`${TTS_BASE}/tts/v3/utteranceSynthesis`, {
      method: 'POST', headers: { authorization: `Api-Key ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: input.text, hints: [{ voice: voiceId }], outputAudioSpec: { containerAudio: { containerAudioType: 'OGG_OPUS' } }, loudnessNormalizationType: 'LUFS', unsafeMode: input.text.length > 250 }),
    });
    if (!response.ok) throw new Error(`SpeechKit synthesis failed with HTTP ${response.status}.`);
    const chunks: Uint8Array[] = [];
    let durationMs = 0;
    for (const item of resultObjects(await response.text()).map(responseResult)) {
      const audio = item.audioChunk as { data?: string } | undefined;
      if (audio?.data) chunks.push(base64ToBytes(audio.data));
      const end = Number(item.startMs ?? 0) + Number(item.lengthMs ?? 0);
      if (Number.isFinite(end)) durationMs = Math.max(durationMs, end);
    }
    const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    if (!length) throw new Error('SpeechKit returned no synthesis audio.');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: 'ready', value: { audio: bytes.buffer, contentType: 'audio/ogg', durationMs: durationMs || undefined, voiceId } };
  }
}
