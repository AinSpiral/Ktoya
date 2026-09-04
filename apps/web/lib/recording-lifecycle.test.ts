import { describe, expect, it } from 'vitest';
import type { CaptureDraftFragment } from './domain';
import { createRecordingBuffer, mergeRecognitionUpdate, restoreInterruptedFragment } from './recording-lifecycle';

const fragment = (): CaptureDraftFragment => ({ fragment: { id: 'audio', position: 1, createdAt: '2026-09-05T00:00:00Z', contentType: 'audio/webm', uploadStatus: 'saved', objectKey: 'owner/story/audio.webm', recognitionStatus: 'processing' }, rawTranscript: 'До исправления', transcript: 'До исправления' });

describe('recording lifecycle recovery and author ownership', () => {
  it('retains a manual correction when a late recognition result arrives', () => {
    const input = { ...fragment(), transcript: 'Мой проверенный текст' };
    const result = mergeRecognitionUpdate(input, { transcript: 'Поздний результат браузера', recognitionStatus: 'complete' });
    expect(result.transcript).toBe('Мой проверенный текст');
    expect(result.rawTranscript).toBe('Поздний результат браузера');
    expect(result.fragment.recognitionStatus).toBe('complete');
    expect(input.transcript).toBe('Мой проверенный текст');
  });
  it('updates an untouched transcript from recognition', () => {
    expect(mergeRecognitionUpdate(fragment(), { transcript: 'Полный результат' }).transcript).toBe('Полный результат');
  });
  it('never gives ownership back when an interim result happens to equal the manual edit', () => {
    const edited = { ...fragment(), transcript: 'Авторский текст', manuallyEdited: true };
    const interim = mergeRecognitionUpdate(edited, { transcript: 'Авторский текст' });
    expect(mergeRecognitionUpdate(interim, { transcript: 'Следующий сырой результат' }).transcript).toBe('Авторский текст');
  });
  it('ends a lost browser recognition session after reload without declaring it complete', () => {
    const result = restoreInterruptedFragment(fragment());
    expect(result.fragment.recognitionStatus).toBe('incomplete');
    expect(result.transcript).toBe('До исправления');
    expect(result.fragment.objectKey).toBe('owner/story/audio.webm');
  });
  it('does not leave an unrecoverable pending upload spinning forever after reload', () => {
    const input = fragment();
    input.fragment = { ...input.fragment, uploadStatus: 'pending', objectKey: undefined };
    expect(restoreInterruptedFragment(input).fragment.uploadStatus).toBe('failed');
  });
  it('preserves completed recording metadata and original source identity', () => {
    const input = fragment();
    input.fragment.recognitionStatus = 'complete';
    expect(restoreInterruptedFragment(input)).toBe(input);
  });
});

describe('recorder session buffer', () => {
  it('retains the beginning, middle and tail of a recording longer than 100 seconds', async () => {
    const session = createRecordingBuffer(1_000);
    session.append(new Blob(['BEGIN']));
    session.append(new Blob(['MIDDLE']));
    session.append(new Blob(['END']));
    const result = session.finish('audio/webm', 106_000)!;
    expect(await result.blob.text()).toBe('BEGINMIDDLEEND');
    expect(result.durationMs).toBe(105_000);
    expect(session.finish('audio/webm', 106_001)).toBeNull();
  });
  it('does not mix sessions when an earlier stop callback arrives late', async () => {
    const first = createRecordingBuffer(0);
    first.append(new Blob(['first']));
    const second = createRecordingBuffer(10);
    second.append(new Blob(['second']));
    first.append(new Blob(['-tail']));
    expect(await first.finish('audio/webm', 20)!.blob.text()).toBe('first-tail');
    expect(await second.finish('audio/webm', 30)!.blob.text()).toBe('second');
  });
  it('rejects empty recordings without creating a fragment', () => {
    const session = createRecordingBuffer(0);
    session.append(new Blob([]));
    expect(session.finish('audio/webm', 1)).toBeNull();
  });
});
