import type { AIStoryContextInput, AIStorySourceInput } from './adapters';
import type { CaptureDraft, CaptureDraftFragment, Story } from './domain';

export function captureFragmentSourceId(fragmentId: string) {
  return `source:audio:${fragmentId}`;
}

export function captureTypedSourceId(draftId: string) {
  return `source:typed:${draftId}`;
}

function selectedCaptureText(item: CaptureDraftFragment) {
  if (item.manuallyEdited) return item.transcript.trim();
  return [...(item.transcriptRevisions ?? [])].reverse().find((revision) => revision.selected)?.text.trim() || item.transcript.trim() || item.rawTranscript?.trim() || '';
}

export function captureDraftSources(draft: CaptureDraft): AIStorySourceInput[] {
  const sources: AIStorySourceInput[] = [];
  if (draft.sourceText.trim()) sources.push({ id: captureTypedSourceId(draft.id), kind: 'typed', text: draft.sourceText.trim() });
  for (const item of draft.storyFragments) {
    const text = selectedCaptureText(item);
    if (text) sources.push({ id: captureFragmentSourceId(item.fragment.id), kind: 'transcript', text, transcriptStatus:item.fragment.recognitionStatus, authorEdited:Boolean(item.manuallyEdited), recordedAt:item.fragment.createdAt });
  }
  for (const answer of draft.interviewAnswers) {
    if (answer.answer.trim()) sources.push({ id: answer.id, kind: 'interview-answer', text: answer.answer.trim(), questionId: answer.questionId });
  }
  return sources;
}

export function contextForCaptureDraft(draft: CaptureDraft): AIStoryContextInput {
  return {
    storyId: draft.id,
    sources: captureDraftSources(draft),
    askedQuestions: (draft.interviewQuestions ?? []).map((question) => ({
      questionId: question.id,
      question: question.text,
      category: question.category,
      disposition: question.disposition,
      answer: draft.interviewAnswers.find((answer) => answer.questionId === question.id)?.answer,
    })),
    currentTitle: draft.assembledDraft?.title,
    currentText: draft.assembledDraft?.text,
    currentRevisionId: draft.assembledDraft?.revisions.at(-1)?.id,
  };
}

export function contextForStory(story: Story): AIStoryContextInput {
  const selectedTranscriptRevisionIds = new Set(
    (story.transcriptRevisions ?? []).filter((revision) => revision.selected).map((revision) => revision.id),
  );
  return {
    storyId: story.id,
    sources: story.sources
      .filter((source): source is typeof source & { kind: AIStorySourceInput['kind'] } => {
        if (source.kind === 'ai-suggestion' || source.kind === 'imported-draft') return false;
        if (source.kind !== 'transcript') return true;
        return Boolean(source.transcriptRevisionId && selectedTranscriptRevisionIds.has(source.transcriptRevisionId));
      })
      .map((source) => ({ id: source.id, kind: source.kind, text: source.text, questionId: source.questionId })),
    askedQuestions: (story.interviewQuestions ?? story.interviewAnswers.map((answer) => ({ id: answer.questionId ?? answer.id, text: answer.question, category: 'gap' as const, purpose: 'Сохранённый вопрос', relatedSourceIds: [], createdAt: answer.createdAt ?? story.createdAt, provider: 'legacy', model: 'legacy' })))
      .map((question) => ({ questionId: question.id, question: question.text, category: question.category, answer: story.interviewAnswers.find((answer) => answer.questionId === question.id)?.answer })),
    currentTitle: story.title,
    currentText: story.text,
    currentRevisionId: story.revisions.at(-1)?.id,
  };
}

export function assertAllowedSourceIds(context: AIStoryContextInput, sourceIds: string[]) {
  const allowed = new Set(context.sources.map((source) => source.id));
  if (!sourceIds.length || sourceIds.some((id) => !allowed.has(id))) throw new Error('AI output references a source outside the current story.');
}
