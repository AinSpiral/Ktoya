import type { AIProvenanceSegment, AIStoryPreview, AITargetedPatch, AppState, FeedbackEntry, InterviewQuestionCategory } from './domain';
import type { VoiceProviderCapabilities } from './voice-provider-registry';

export interface AIStorySourceInput {
  id: string;
  kind: 'typed' | 'transcript' | 'interview-answer' | 'manual-edit';
  text: string;
  questionId?: string;
}

export interface AIStoryContextInput {
  storyId: string;
  sources: AIStorySourceInput[];
  askedQuestions: Array<{ questionId: string; question: string; category?: InterviewQuestionCategory; answer?: string }>;
  currentTitle?: string;
  currentText?: string;
  currentRevisionId?: string;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIProviderResult<T> {
  value: T;
  model: string;
  usage: AIUsage;
}

export type AIInterviewDecision =
  | { decision: 'ASK'; question: string; anchorQuote: string; category: InterviewQuestionCategory; purpose: string; relatedSourceIds: string[] }
  | { decision: 'READY'; reason: string };

export interface AIAssemblyProposal {
  title: string;
  storyText: string;
  provenance: AIProvenanceSegment[];
  uncertainties: string[];
}

export interface AIRephraseProposal {
  storyText: string;
  sourceIds: string[];
  reason: string;
}

export interface AIPatchRequest {
  expectedOldText: string;
  instruction: string;
}

export interface AIProvider {
  readonly id: string;
  readonly mode: 'deterministic' | 'connected';
  nextInterviewStep(input: AIStoryContextInput): Promise<AIProviderResult<AIInterviewDecision>>;
  assemble(input: AIStoryContextInput): Promise<AIProviderResult<AIAssemblyProposal>>;
  rephrase(input: AIStoryContextInput): Promise<AIProviderResult<AIRephraseProposal>>;
  patch(input: AIStoryContextInput, request: AIPatchRequest): Promise<AIProviderResult<AITargetedPatch>>;
}

/** Live microphone fallback. It never processes an already saved recording. */
export interface LiveTranscriptionProvider {
  isAvailable(): boolean;
  canRetranscribe(): boolean;
  retranscriptionUnavailableReason(): string | null;
  start(onText: (text: string) => void, onError: (message: string) => void): void;
  stop(): void;
}

/**
 * Browser recognition can listen to a live microphone but cannot safely replay
 * a stored Blob through SpeechRecognition.  A production provider can replace
 * this boundary and implement real retranscription without changing provenance.
 */
export class BrowserSpeechTranscriptionProvider implements LiveTranscriptionProvider {
  isAvailable() {
    return typeof window !== 'undefined' && Boolean((window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
      ?? (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  }
  canRetranscribe() { return false; }
  retranscriptionUnavailableReason() {
    return 'Автоматическая повторная расшифровка сохранённого аудио станет доступна после подключения STT-провайдера. Сейчас можно создать отдельную ручную версию текста.';
  }
  start() { throw new Error('Live browser transcription is coordinated by the recording lifecycle.'); }
  stop() { /* SpeechRecognition is stopped by the recording lifecycle. */ }
}

export const browserSpeechTranscriptionProvider = new BrowserSpeechTranscriptionProvider();

export type ProviderJobResult<T> =
  | { status: 'processing'; externalJobId: string }
  | { status: 'ready'; value: T };

/** Production boundary for an immutable, already saved AudioFragment. */
export interface TranscriptionProvider {
  readonly id: string;
  submit(input: {
    audio: ArrayBuffer;
    contentType: string;
    language: 'ru-RU';
    literatureText?: boolean;
  }): Promise<ProviderJobResult<{ text: string }>>;
  poll?(externalJobId: string): Promise<ProviderJobResult<{ text: string }>>;
}

/** Production boundary that returns a reusable media asset, not browser speech. */
export interface TTSProvider {
  readonly id: string;
  submit(input: {
    text: string;
    language: 'ru-RU';
    voiceId: string;
  }): Promise<ProviderJobResult<{ audio: ArrayBuffer; contentType: string; durationMs?: number; voiceId?: string }>>;
  poll?(externalJobId: string): Promise<ProviderJobResult<{ audio: ArrayBuffer; contentType: string; durationMs?: number; voiceId?: string }>>;
}

export interface StorageAdapter {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<AppState>;
  saveFeedback(entry: FeedbackEntry): Promise<void>;
  saveAudio(storyId: string, fragmentId: string, blob: Blob): Promise<string>;
  saveDerivedAudio(storyId: string, fragmentId: string, assetId: string, blob: Blob): Promise<string>;
  audioUrl(objectKey: string): string;
}

export class StorageConflictError extends Error {}

export interface AuthAdapter {
  currentUser(): Promise<{ id: string; email: string; name: string } | null>;
}

export interface PaymentAdapter {
  status: 'not-connected';
}

export interface ExportAdapter {
  json(state: AppState): void;
  markdown(state: AppState): void;
  print(): void;
}

export class HttpStorageAdapter implements StorageAdapter {
  private headers(contentType?: string) {
    const headers: Record<string, string> = contentType ? { 'content-type': contentType } : {};
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) headers['x-ktoya-dev-user'] = 'local-development-author';
    return headers;
  }
  async load() {
    const response = await fetch('/api/state', { cache: 'no-store', headers: this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Не удалось загрузить книгу');
    return response.json() as Promise<AppState>;
  }
  async save(state: AppState) {
    const response = await fetch('/api/state', { method: 'PUT', headers: this.headers('application/json'), body: JSON.stringify(state) });
    if (response.status === 409) throw new StorageConflictError('Книга изменилась в другой вкладке');
    if (!response.ok) throw new Error('Не удалось сохранить книгу');
    return response.json() as Promise<AppState>;
  }
  async saveFeedback(entry: FeedbackEntry) {
    const response = await fetch('/api/feedback', { method: 'POST', headers: this.headers('application/json'), body: JSON.stringify(entry) });
    if (!response.ok) throw new Error('Не удалось сохранить обратную связь');
  }
  async saveAudio(storyId: string, fragmentId: string, blob: Blob) {
    const response = await fetch(`/api/media?story=${encodeURIComponent(storyId)}&fragment=${encodeURIComponent(fragmentId)}`, { method: 'PUT', headers: this.headers(blob.type || 'audio/webm'), body: blob });
    if (!response.ok) throw new Error('Не удалось сохранить запись');
    const result = await response.json() as { key: string };
    return result.key;
  }
  async saveDerivedAudio(storyId: string, fragmentId: string, assetId: string, blob: Blob) {
    const response = await fetch(`/api/media?story=${encodeURIComponent(storyId)}&fragment=${encodeURIComponent(fragmentId)}&asset=${encodeURIComponent(assetId)}&kind=derived`, { method: 'PUT', headers: this.headers(blob.type || 'audio/wav'), body: blob });
    if (!response.ok) throw new Error('Не удалось сохранить техническую копию записи');
    const result = await response.json() as { key: string };
    return result.key;
  }
  audioUrl(objectKey: string) {
    return `/api/media?key=${encodeURIComponent(objectKey)}`;
  }
}

export class HttpVoiceProcessingAdapter {
  private headers(contentType?: string) {
    const headers: Record<string, string> = contentType ? { 'content-type': contentType } : {};
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) headers['x-ktoya-dev-user'] = 'local-development-author';
    return headers;
  }

  async capabilities(): Promise<VoiceProviderCapabilities> {
    const response = await fetch('/api/voice/capabilities', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось проверить готовность голосовых сервисов.');
    return response.json() as Promise<VoiceProviderCapabilities>;
  }

  async transcribe(storyId: string, audioFragmentId: string, processingMode: 'faithful' | 'literature-derived' = 'faithful'): Promise<AppState> {
    return this.post('/api/voice/transcription', { storyId, audioFragmentId, ...(processingMode === 'faithful' ? {} : { processingMode }) });
  }

  async transcribeCaptureDraft(captureDraftId: string, audioFragmentId: string, processingMode: 'faithful' | 'literature-derived' = 'faithful'): Promise<AppState> {
    return this.post('/api/voice/transcription', { captureDraftId, audioFragmentId, ...(processingMode === 'faithful' ? {} : { processingMode }) });
  }

  async narrate(storyId: string, voiceId?: string): Promise<AppState> {
    return this.post('/api/voice/narration', { storyId, ...(voiceId ? { voiceId } : {}) });
  }

  private async post(path: string, body: Record<string, string>): Promise<AppState> {
    const response = await fetch(path, { method: 'POST', headers: this.headers('application/json'), body: JSON.stringify(body) });
    if (response.status === 409) throw new StorageConflictError('Книга изменилась в другой вкладке');
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(detail?.message ?? 'Голосовая операция не завершилась. Исходный материал сохранён.');
    }
    return response.json() as Promise<AppState>;
  }
}

export interface AIProviderCapabilities {
  mode: 'deterministic' | 'connected';
  provider: string;
  model: string;
  trialQaOnly: true;
  message: string;
}

export type AIClientResult = {
  state: AppState;
  mode?: AIProviderCapabilities['mode'];
  provider?: string;
  decision?: ({ decision: 'ASK'; questionId: string; question: string; anchorQuote?: string; category: InterviewQuestionCategory; purpose: string; relatedSourceIds: string[] } | { decision: 'READY'; reason: string });
  preview?: AIStoryPreview;
  model?: string;
  usage?: AIUsage;
  actualCostRub?: number;
};

export class HttpAIProcessingAdapter {
  private headers(contentType?: string) {
    const headers: Record<string, string> = contentType ? { 'content-type': contentType } : {};
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) headers['x-ktoya-dev-user'] = 'local-development-author';
    return headers;
  }

  async capabilities(): Promise<AIProviderCapabilities> {
    const response = await fetch('/api/ai/capabilities', { cache: 'no-store', headers: this.headers() });
    if (!response.ok) throw new Error('Не удалось проверить режим AI.');
    return response.json() as Promise<AIProviderCapabilities>;
  }

  nextInterviewStep(captureDraftId: string, operationId: string) { return this.post({ action: 'interview-next', captureDraftId, operationId }); }
  assemble(captureDraftId: string, operationId: string) { return this.post({ action: 'assembly', captureDraftId, operationId }); }
  rephrase(owner: { storyId?: string; captureDraftId?: string }, operationId: string) { return this.post({ action: 'rephrase', ...owner, operationId }); }
  patch(owner: { storyId?: string; captureDraftId?: string }, operationId: string, expectedOldText: string, instruction: string) { return this.post({ action: 'patch', ...owner, operationId, expectedOldText, instruction }); }
  applyPreview(owner: { storyId?: string; captureDraftId?: string }, operationId: string, previewId: string) { return this.post({ action: 'apply-preview', ...owner, operationId, previewId }); }
  keepOriginal(owner: { storyId?: string; captureDraftId?: string }, operationId: string, previewId: string) { return this.post({ action: 'keep-original', ...owner, operationId, previewId }); }
  undo(owner: { storyId?: string; captureDraftId?: string }, operationId: string) { return this.post({ action: 'undo', ...owner, operationId }); }

  private async post(body: Record<string, string | undefined>): Promise<AIClientResult> {
    const response = await fetch('/api/ai/operation', { method: 'POST', headers: this.headers('application/json'), body: JSON.stringify(body) });
    if (response.status === 409) throw new StorageConflictError((await response.json().catch(() => null) as { message?: string } | null)?.message ?? 'AI-операция уже выполнялась или история изменилась.');
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(detail?.message ?? 'AI-предложение не создано. Исходный текст сохранён.');
    }
    return response.json() as Promise<AIClientResult>;
  }
}

export class HeaderAuthAdapter implements AuthAdapter {
  async currentUser() {
    const response = await fetch('/api/me', { cache: 'no-store' });
    if (!response.ok) return null;
    return response.json() as Promise<{ id: string; email: string; name: string }>;
  }
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const browserExportAdapter: ExportAdapter = {
  json(state) { download('ktoya-book.json', JSON.stringify(state, null, 2), 'application/json'); },
  markdown(state) {
    const body = [`# ${state.book.title}`, ...state.stories.flatMap((story) => [`\n## ${story.title}\n`, story.text])].join('\n');
    download('ktoya-book.md', body, 'text/markdown;charset=utf-8');
  },
  print() { window.print(); },
};
