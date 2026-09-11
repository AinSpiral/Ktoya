import type { AIAssemblyProposal, AIInterviewDecision, AIProviderResult, AIRephraseProposal } from './adapters';
import type { AITargetedPatch, AIStoryPreview, CaptureDraft, InterviewQuestion, Story, StoryTitleRevision } from './domain';
import { assertAllowedSourceIds, contextForCaptureDraft, contextForStory } from './ai-story-context';
import { assertGroundedQuestion, assertNoUnsupportedLexicalAnchors } from './ai-output-safety';
import { assembleCaptureDraft } from './story-logic';

const SAFE_INTERVIEW_LANGUAGE: Record<InterviewQuestion['category'], { question: (quote: string) => string; purpose: string }> = {
  gap: { question: (quote) => `Ты упомянул «${quote}». Что ещё здесь важно сохранить?`, purpose: 'Помочь Автору самому добавить важный недостающий фрагмент' },
  contradiction: { question: (quote) => `Ты упомянул «${quote}». Что здесь точнее по твоей памяти?`, purpose: 'Уточнить противоречие, не выбирая версию за Автора' },
  meaning: { question: (quote) => `Ты упомянул «${quote}». Что это значит для тебя?`, purpose: 'Раскрыть значение события только словами Автора' },
  detail: { question: (quote) => `Ты упомянул «${quote}». Какую подробность здесь важно сохранить?`, purpose: 'Предложить Автору самому выбрать важную деталь' },
  change: { question: (quote) => `Ты упомянул «${quote}». Изменилось ли после этого что-то, что ты сам хочешь отметить?`, purpose: 'Уточнить возможное изменение без предположения, что оно было' },
  people: { question: (quote) => `Ты упомянул «${quote}». Чьё участие здесь важно сохранить?`, purpose: 'Уточнить участников без добавления новых людей' },
  'time-place': { question: (quote) => `Ты упомянул «${quote}». Что ты сам помнишь о времени или месте?`, purpose: 'Уточнить время или место только по памяти Автора' },
};

function safeInterviewWording(context: ReturnType<typeof contextForCaptureDraft>, decision: Extract<AIInterviewDecision, { decision: 'ASK' }>) {
  const related = context.sources.filter((source) => decision.relatedSourceIds.includes(source.id));
  const exact = related.some((source) => source.text.includes(decision.anchorQuote)) ? decision.anchorQuote : '';
  const fallback = related[0]?.text.split(/(?<=[.!?…])\s/)[0]?.slice(0, 180).trim() ?? '';
  const rawAnchor = (exact || fallback).replace(/\s+/g, ' ').trim();
  const sentence = rawAnchor.match(/^.{1,110}?[.!?…](?=\s|$)/u)?.[0];
  const clipped = rawAnchor.slice(0, 111);
  const wordBoundary = clipped.lastIndexOf(' ');
  const anchorQuote = rawAnchor.length <= 110
    ? rawAnchor
    : sentence ?? rawAnchor.slice(0, wordBoundary >= 60 ? wordBoundary : 110).trimEnd();
  if (!anchorQuote) throw new Error('AI question has no confirmed source anchor.');
  const language = SAFE_INTERVIEW_LANGUAGE[decision.category];
  const displayQuote = anchorQuote.replace(/[.!?…]+$/, '');
  return { anchorQuote, question: language.question(displayQuote), purpose: language.purpose };
}

export function appendInterviewDecision(draft: CaptureDraft, operationId: string, provider: string, result: AIProviderResult<AIInterviewDecision>) {
  if (result.value.decision === 'READY') return { draft, decision: result.value };
  if ((draft.interviewQuestions?.length ?? 0) >= 8) return { draft, decision: { decision: 'READY' as const, reason: 'Достигнут аварийный предел восьми вопросов.' } };
  const context = contextForCaptureDraft(draft);
  assertAllowedSourceIds(context, result.value.relatedSourceIds);
  const safe = safeInterviewWording(context, result.value);
  if (provider === 'yandex-ai-studio' || provider === 'synthetic-semantic-fixture') {
    const proposed = result.value;
    if (!context.sources.some(source => proposed.relatedSourceIds.includes(source.id) && source.text.includes(proposed.anchorQuote))) throw new Error('Semantic question requires an exact source anchor.');
    if (!proposed.question.trim() || proposed.question.length > 500 || !proposed.purpose.trim()) throw new Error('Semantic question requires one bounded purposeful question.');
    assertNoUnsupportedLexicalAnchors(context, proposed.question);
    assertGroundedQuestion(context, proposed.question);
    safe.question = proposed.question;
    safe.purpose = proposed.purpose;
    safe.anchorQuote = proposed.anchorQuote;
  }
  const normalized = safe.question.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
  if ((draft.interviewQuestions ?? []).some((question) => question.text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU') === normalized)) throw new Error('AI attempted to repeat an already asked question.');
  const question: InterviewQuestion = {
    id: crypto.randomUUID(), text: safe.question, anchorQuote: safe.anchorQuote, category: result.value.category, purpose: safe.purpose,
    relatedSourceIds: result.value.relatedSourceIds, createdAt: new Date().toISOString(), operationId, provider, model: result.model,
  };
  return { draft: { ...draft, interviewQuestions: [...(draft.interviewQuestions ?? []), question], updatedAt: question.createdAt }, decision: { decision: 'ASK' as const, questionId: question.id, question: question.text, anchorQuote: question.anchorQuote, category: question.category, purpose: question.purpose, relatedSourceIds: question.relatedSourceIds } };
}

export function makeAssemblyPreview(draft: CaptureDraft, operationId: string, provider: string, result: AIProviderResult<AIAssemblyProposal>): AIStoryPreview {
  const context = contextForCaptureDraft(draft);
  const sourceIds = [...new Set(result.value.provenance.flatMap((segment) => segment.sourceIds))];
  assertAllowedSourceIds(context, sourceIds);
  for (const segment of result.value.provenance) assertAllowedSourceIds(context, segment.sourceIds);
  assertNoUnsupportedLexicalAnchors(context, `${result.value.title}\n${result.value.storyText}`);
  return { id: crypto.randomUUID(), operationId, type: 'assembly', provider, model: result.model, createdAt: new Date().toISOString(), status: 'pending', sourceSnapshot:JSON.stringify(context.sources), sourceIds, title: result.value.title, storyText: result.value.storyText, provenance: result.value.provenance, uncertainties: result.value.uncertainties };
}

export function makeRephrasePreview(story: Story, operationId: string, provider: string, result: AIProviderResult<AIRephraseProposal>): AIStoryPreview {
  const context = contextForStory(story);
  assertAllowedSourceIds(context, result.value.sourceIds);
  assertNoUnsupportedLexicalAnchors(context, result.value.storyText);
  return { id: crypto.randomUUID(), operationId, type: 'rephrase', provider, model: result.model, createdAt: new Date().toISOString(), status: 'pending', baseRevisionId: context.currentRevisionId, sourceIds: result.value.sourceIds, storyText: result.value.storyText, uncertainties: [result.value.reason] };
}

export function makePatchPreview(story: Story, operationId: string, provider: string, result: AIProviderResult<AITargetedPatch>): AIStoryPreview {
  const context = contextForStory(story);
  const patch = result.value;
  assertAllowedSourceIds(context, patch.sourceIds);
  assertNoUnsupportedLexicalAnchors(context, patch.replacementText);
  return { id: crypto.randomUUID(), operationId, type: 'patch', provider, model: result.model, createdAt: new Date().toISOString(), status: 'pending', baseRevisionId: context.currentRevisionId, sourceIds: patch.sourceIds, patch };
}

export function applyAssemblyPreview(draft: CaptureDraft, previewId: string) {
  const preview = draft.aiPreviews?.find((item) => item.id === previewId && item.type === 'assembly');
  if (preview && draft.assembledDraft?.revisions.some((revision) => revision.operationId === preview.operationId)) return draft;
  if (!preview?.storyText || !preview.title || preview.status !== 'pending') throw new Error('Assembly preview is unavailable or already resolved.');
  if (preview.sourceSnapshot && preview.sourceSnapshot !== JSON.stringify(contextForCaptureDraft(draft).sources)) throw new Error('Source material changed after this preview. Create a new proposal.');
  const base = assembleCaptureDraft(draft);
  if (!base) throw new Error('Confirmed source material is required.');
  const now = new Date().toISOString();
  const revisionId = crypto.randomUUID();
  const titleRevision: StoryTitleRevision = { id: crypto.randomUUID(), title: preview.title, provider: 'ai', createdAt: now, selected: true };
  const assembledDraft: Story = {
    ...base, title: preview.title, text: preview.storyText, updatedAt: now,
    revisions: [...base.revisions, { id: revisionId, text: preview.storyText, createdAt: now, reason: 'ai-suggestion-applied', operationId: preview.operationId, basedOnRevisionId: base.revisions.at(-1)?.id }],
    titleRevisions: [...(base.titleRevisions ?? []).map((item) => ({ ...item, selected: false })), titleRevision],
    aiPreviews: (draft.aiPreviews ?? []).map((item) => item.id === preview.id ? { ...item, status: 'applied', createdRevisionId: revisionId } : item),
  };
  return { ...draft, assembledDraft, aiPreviews: assembledDraft.aiPreviews, updatedAt: now };
}

export function applyStoryPreview(story: Story, previewId: string): Story {
  const preview = story.aiPreviews?.find((item) => item.id === previewId);
  if (!preview || preview.type === 'assembly') throw new Error('Story preview is unavailable or already resolved.');
  if (story.revisions.some((revision) => revision.operationId === preview.operationId)) return story;
  if (preview.status !== 'pending') throw new Error('Story preview is unavailable or already resolved.');
  const current = story.revisions.at(-1);
  if (!current || current.id !== preview.baseRevisionId) throw new Error('Story changed after this preview. Create a new proposal for the current revision.');
  let text: string;
  let reason: 'ai-rephrase' | 'ai-patch';
  if (preview.type === 'rephrase') {
    if (!preview.storyText?.trim()) throw new Error('Rephrase preview has no text.');
    text = preview.storyText.trim();
    reason = 'ai-rephrase';
  } else {
    const patch = preview.patch;
    if (!patch) throw new Error('Patch preview is incomplete.');
    const occurrences = current.text.split(patch.expectedOldText).length - 1;
    if (occurrences !== 1) throw new Error(occurrences ? 'The target fragment is ambiguous; use manual editing.' : 'The target fragment no longer matches the base revision.');
    text = current.text.replace(patch.expectedOldText, patch.replacementText);
    reason = 'ai-patch';
  }
  if (text === current.text) throw new Error('The proposal does not change the story.');
  const now = new Date().toISOString();
  const revisionId = crypto.randomUUID();
  return {
    ...story, text, updatedAt: now,
    revisions: [...story.revisions, { id: revisionId, text, createdAt: now, reason, operationId: preview.operationId, basedOnRevisionId: current.id }],
    aiPreviews: (story.aiPreviews ?? []).map((item) => item.id === preview.id ? { ...item, status: 'applied', createdRevisionId: revisionId } : item),
  };
}

export function keepOriginalPreview<T extends CaptureDraft | Story>(owner: T, previewId: string): T {
  if (!owner.aiPreviews?.some((item) => item.id === previewId && item.status === 'pending')) return owner;
  return { ...owner, aiPreviews: owner.aiPreviews.map((item) => item.id === previewId ? { ...item, status: 'kept-original' as const } : item), updatedAt: new Date().toISOString() };
}

/** Single-level safe Undo: appends the prior text as a new revision and preserves every prior row. */
export function undoLatestStoryTextChange(story: Story, operationId: string): Story {
  if (story.revisions.some((revision) => revision.operationId === operationId)) return story;
  const latest = story.revisions.at(-1);
  if (!latest || latest.reason === 'assembled' || latest.reason === 'undo' || !latest.basedOnRevisionId) throw new Error('There is no latest applied text change available for Undo.');
  const previous = story.revisions.find((revision) => revision.id === latest.basedOnRevisionId);
  if (!previous) throw new Error('The prior preserved revision is unavailable.');
  const now = new Date().toISOString();
  return { ...story, text: previous.text, updatedAt: now, revisions: [...story.revisions, { id: crypto.randomUUID(), text: previous.text, createdAt: now, reason: 'undo', operationId, basedOnRevisionId: latest.id, undoesRevisionId: latest.id }] };
}
