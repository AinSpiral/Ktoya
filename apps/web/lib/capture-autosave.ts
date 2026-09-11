import type { CaptureDraft } from './domain';

/** A delayed UI autosave owns input, not newer server-created AI history. */
export function mergeCaptureAutosave(input: CaptureDraft, previous?: CaptureDraft): CaptureDraft {
  if (!previous) return input;
  return {
    ...input,
    interviewQuestions: previous.interviewQuestions ?? input.interviewQuestions,
    aiReadyDecisions: previous.aiReadyDecisions ?? input.aiReadyDecisions,
    aiPreviews: previous.aiPreviews ?? input.aiPreviews,
    assembledDraft: input.assembledDraft && input.assembledDraft.revisions.length >= (previous.assembledDraft?.revisions.length ?? 0)
      ? input.assembledDraft : previous.assembledDraft,
  };
}
