import type { AudioFragment, CaptureDraftFragment } from './domain';

export function mergeRecognitionUpdate<T extends CaptureDraftFragment>(item: T, patch: { transcript?: string; recognitionStatus?: AudioFragment['recognitionStatus'] }): T {
  const authorEdited = item.manuallyEdited || item.transcript !== (item.rawTranscript ?? item.transcript);
  return { ...item, manuallyEdited: Boolean(authorEdited), rawTranscript: patch.transcript ?? item.rawTranscript, transcript: authorEdited ? item.transcript : patch.transcript ?? item.transcript, fragment: { ...item.fragment, ...(patch.recognitionStatus ? { recognitionStatus: patch.recognitionStatus } : {}) } };
}

export function restoreInterruptedFragment<T extends CaptureDraftFragment>(item: T): T {
  const interruptedRecognition = item.fragment.recognitionStatus === 'processing';
  const interruptedUpload = item.fragment.uploadStatus === 'pending' && !item.fragment.objectKey;
  if (!interruptedRecognition && !interruptedUpload) return item;
  return { ...item, fragment: { ...item.fragment, ...(interruptedRecognition ? { recognitionStatus: 'incomplete' as const } : {}), ...(interruptedUpload ? { uploadStatus: 'failed' as const } : {}) } };
}

/** Each recorder owns its chunks; a later session can never reset this buffer. */
export function createRecordingBuffer(startedAt: number) {
  const chunks: Blob[] = [];
  let finished = false;
  return {
    append(chunk: Blob) { if (!finished && chunk.size) chunks.push(chunk); },
    finish(contentType: string, stoppedAt: number) {
      if (finished) return null;
      finished = true;
      const blob = new Blob(chunks, { type: contentType });
      return blob.size ? { blob, durationMs: Math.max(1, stoppedAt - startedAt) } : null;
    },
  };
}
