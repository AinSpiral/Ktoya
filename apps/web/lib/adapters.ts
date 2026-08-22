import type { AppState, FeedbackEntry } from './domain';

export interface AIProvider {
  assemble(sourceText: string, answers: Array<{ answer: string }>): Promise<string>;
  mode: 'deterministic' | 'connected';
}

export interface TranscriptionProvider {
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
export class BrowserSpeechTranscriptionProvider implements TranscriptionProvider {
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

export interface TTSProvider {
  isAvailable(): boolean;
  speak(text: string): void;
  stop(): void;
}

export interface StorageAdapter {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<AppState>;
  saveFeedback(entry: FeedbackEntry): Promise<void>;
  saveAudio(storyId: string, fragmentId: string, blob: Blob): Promise<string>;
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
