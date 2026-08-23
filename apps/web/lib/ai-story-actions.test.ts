import { describe, expect, it } from 'vitest';
import type { CaptureDraft } from './domain';
import { appendStoryTextRevision, assembleCaptureDraft } from './story-logic';
import { appendInterviewDecision, applyAssemblyPreview, applyStoryPreview, keepOriginalPreview, makeAssemblyPreview, makeRephrasePreview, undoLatestStoryTextChange } from './ai-story-actions';

function draft(): CaptureDraft {
  return { id: 'qa-draft', sourceText: 'В субботу я собрал бумажный кораблик.', answer: '', interviewAnswers: [], storyFragments: [], answerFragments: [], voiceAnswerDrafts: [], capturePurpose: 'story', externalProcessingPolicy: 'qa-nonpersonal-trial', updatedAt: '2026-08-23T12:00:00.000Z' };
}

describe('AI story state transitions', () => {
  it('creates stable application questionId, rejects repeats and enforces eight-question emergency limit', () => {
    const base = draft();
    const result = { model: 'aliceai-llm', usage: { inputTokens: 10, outputTokens: 10 }, value: { decision: 'ASK' as const, question: 'Что могло стать причиной возгорания?', anchorQuote: 'бумажный кораблик.', category: 'detail' as const, purpose: 'Уточнить деталь', relatedSourceIds: [`source:typed:${base.id}`] } };
    const first = appendInterviewDecision(base, 'op-1', 'yandex-ai-studio', result);
    expect(first.draft.interviewQuestions?.[0]).toMatchObject({ id: expect.any(String), operationId: 'op-1' });
    expect(first.draft.interviewQuestions?.[0].text).toBe('Ты упомянул «бумажный кораблик». Какую подробность здесь важно сохранить?');
    expect(first.draft.interviewQuestions?.[0].text).not.toContain('возгорания');
    expect(() => appendInterviewDecision(first.draft, 'op-2', 'yandex-ai-studio', result)).toThrow('repeat');
    const limited = appendInterviewDecision({ ...base, interviewQuestions: Array.from({ length: 8 }, (_, index) => ({ id: `q-${index}`, text: `Вопрос ${index}`, category: 'gap' as const, purpose: 'QA', relatedSourceIds: [`source:typed:${base.id}`], createdAt: base.updatedAt, provider: 'mock', model: 'mock' })) }, 'op-limit', 'mock', result);
    expect(limited.decision.decision).toBe('READY');
  });

  it('applies assembly only as a new StoryRevision and keeps source provenance', () => {
    const base = draft();
    const preview = makeAssemblyPreview(base, 'op-assembly', 'mock', { model: 'mock', usage: { inputTokens: 0, outputTokens: 0 }, value: { title: 'Кораблик', storyText: base.sourceText, provenance: [{ segment: base.sourceText, sourceIds: [`source:typed:${base.id}`] }], uncertainties: [] } });
    const applied = applyAssemblyPreview({ ...base, aiPreviews: [preview] }, preview.id);
    expect(applied.assembledDraft?.revisions).toHaveLength(2);
    expect(applied.assembledDraft?.sources).toHaveLength(1);
    expect(applied.aiPreviews?.[0]).toMatchObject({ status: 'applied', createdRevisionId: expect.any(String) });
  });

  it('applies an exact unique patch and refuses an ambiguous target', () => {
    const story = assembleCaptureDraft(draft())!;
    const baseRevisionId = story.revisions.at(-1)!.id;
    const preview = { id: 'preview-patch', operationId: 'op-patch', type: 'patch' as const, provider: 'mock', model: 'mock', createdAt: story.updatedAt, status: 'pending' as const, baseRevisionId, sourceIds: [story.sources[0].id], patch: { expectedOldText: 'бумажный', replacementText: 'синий бумажный', reason: 'Уточнение Автора', sourceIds: [story.sources[0].id] } };
    const patched = applyStoryPreview({ ...story, aiPreviews: [preview] }, preview.id);
    expect(patched.text).toContain('синий бумажный');
    expect(patched.revisions.at(-1)).toMatchObject({ reason: 'ai-patch', operationId: 'op-patch', basedOnRevisionId: baseRevisionId });
    const ambiguousBase = { ...story, text: 'фрагмент и фрагмент', revisions: [{ ...story.revisions[0], text: 'фрагмент и фрагмент' }], aiPreviews: [{ ...preview, baseRevisionId: story.revisions[0].id, patch: { ...preview.patch, expectedOldText: 'фрагмент' } }] };
    expect(() => applyStoryPreview(ambiguousBase, preview.id)).toThrow('ambiguous');
  });

  it('Undo appends a restoring revision and never removes the changed revision or sources', () => {
    const story = assembleCaptureDraft(draft())!;
    const edited = appendStoryTextRevision(story, `${story.text}\n\nРучное дополнение.`);
    const undone = undoLatestStoryTextChange(edited, 'undo-op-1');
    expect(undone.text).toBe(story.text);
    expect(undone.revisions).toHaveLength(story.revisions.length + 2);
    expect(undone.revisions.at(-1)).toMatchObject({ reason: 'undo', undoesRevisionId: edited.revisions.at(-1)?.id });
    expect(undone.sources).toHaveLength(edited.sources.length);
  });

  it('persists preview, apply, keep-original, and append-only provenance across a reload roundtrip', () => {
    const story = assembleCaptureDraft(draft())!;
    const preview = makeRephrasePreview(story, 'op-rephrase', 'mock', { model: 'mock-v1', usage: { inputTokens: 20, outputTokens: 10 }, value: { storyText: `${story.text} Это проверенная формулировка.`, sourceIds: story.sources.map((source) => source.id), reason: 'Связность' } });
    const reloadedPending = JSON.parse(JSON.stringify({ ...story, aiPreviews: [preview] })) as typeof story;
    const applied = applyStoryPreview(reloadedPending, preview.id);
    const reloadedApplied = JSON.parse(JSON.stringify(applied)) as typeof story;
    expect(reloadedApplied.revisions).toHaveLength(story.revisions.length + 1);
    expect(reloadedApplied.aiPreviews?.[0]).toMatchObject({ status: 'applied', operationId: 'op-rephrase', createdRevisionId: expect.any(String) });
    expect(reloadedApplied.sources).toEqual(story.sources);
    expect(applyStoryPreview(reloadedApplied, preview.id)).toBe(reloadedApplied);

    const other = { ...story, aiPreviews: [{ ...preview, id: 'preview-kept', operationId: 'op-kept' }] };
    const kept = keepOriginalPreview(other, 'preview-kept');
    expect(kept.text).toBe(story.text);
    expect(kept.revisions).toEqual(story.revisions);
    expect(kept.aiPreviews?.[0].status).toBe('kept-original');
  });
});
