import type { AppState, FeedbackEntry } from './domain';

export interface AIProvider {
  assemble(sourceText: string, answers: Array<{ answer: string }>): Promise<string>;
  mode: 'deterministic' | 'connected';
}

export interface TranscriptionProvider {
  isAvailable(): boolean;
  start(onText: (text: string) => void, onError: (message: string) => void): void;
  stop(): void;
}

export interface TTSProvider {
  isAvailable(): boolean;
  speak(text: string): void;
  stop(): void;
}

export interface StorageAdapter {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  saveFeedback(entry: FeedbackEntry): Promise<void>;
  saveAudio(storyId: string, blob: Blob): Promise<string>;
}

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
  async load() {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Не удалось загрузить книгу');
    return response.json() as Promise<AppState>;
  }
  async save(state: AppState) {
    const response = await fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) });
    if (!response.ok) throw new Error('Не удалось сохранить книгу');
  }
  async saveFeedback(entry: FeedbackEntry) {
    const response = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry) });
    if (!response.ok) throw new Error('Не удалось сохранить обратную связь');
  }
  async saveAudio(storyId: string, blob: Blob) {
    const response = await fetch(`/api/media?story=${encodeURIComponent(storyId)}`, { method: 'PUT', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
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
