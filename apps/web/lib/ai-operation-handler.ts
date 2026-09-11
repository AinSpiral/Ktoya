import { NextRequest, NextResponse } from 'next/server';
import type { AIProvider, AIProviderResult } from './adapters';
import type { AIStoryPreview, AppState, CaptureDraft, Story } from './domain';
import { AliceAIProvider, AliceAIProviderError } from './alice-ai-provider';
import { DeterministicAIProvider } from './deterministic-ai-provider';
import { actualAiCostRub, completeAiOperation, estimateAiMaxCostRub, failAiOperation, findAiOperation, linkAiOperationRevision, markAiOperationUncertain, reserveAiOperation, type AIOperationKind } from './ai-trial-budget';
import { readAliceTrialConfig, type AliceTrialConfig } from './ai-trial-config';
import { canUseAliceTrial } from './ai-trial-policy';
import { appendInterviewDecision, applyAssemblyPreview, applyStoryPreview, keepOriginalPreview, makeAssemblyPreview, makePatchPreview, makeRephrasePreview, undoLatestStoryTextChange } from './ai-story-actions';
import { contextForCaptureDraft, contextForStory } from './ai-story-context';
import { authenticatedUserId } from './server-auth';
import { loadAuthorState, saveAuthorState, StateConflictError } from './server-state';
import { isNarrativeStyle } from './story-styles';
import { completeLiveBetaOperation, estimateTextOperationMaxRub, failLiveBetaOperation, findLiveBetaOperation, liveBetaCostRub, noteLiveBetaProviderCall, reserveLiveBetaOperation } from './live-beta-budget';
import { readLiveBetaConfig, type LiveBetaConfig } from './live-beta-config';
import { hasFinalRealtimeBilling, YandexRealtimeAIProvider, YandexRealtimeError } from './yandex-realtime-provider';
import { LIVE_BETA_CONSENT_VERSION } from './live-beta-config';

type GenerateBody = {
  action: AIOperationKind;
  operationId: string;
  captureDraftId?: string;
  storyId?: string;
  expectedOldText?: string;
  instruction?: string;
  narrativeStyle?: unknown;
};

type MutationBody = {
  action: 'apply-preview' | 'keep-original' | 'undo';
  operationId: string;
  captureDraftId?: string;
  storyId?: string;
  previewId?: string;
};

function validId(value: unknown) { return typeof value === 'string' && value.length >= 6 && value.length <= 200; }

function findExistingResult(state: AppState, body: GenerateBody) {
  const draft = body.captureDraftId ? state.captureDrafts?.find((item) => item.id === body.captureDraftId) : undefined;
  const story = body.storyId ? state.stories.find((item) => item.id === body.storyId) : undefined;
  const question = draft?.interviewQuestions?.find((item) => item.operationId === body.operationId);
  if (question) return { state, decision: { decision: 'ASK', questionId: question.id, question: question.text, anchorQuote: question.anchorQuote, category: question.category, purpose: question.purpose, relatedSourceIds: question.relatedSourceIds }, idempotent: true };
  const ready = draft?.aiReadyDecisions?.find((item) => item.operationId === body.operationId);
  if (ready) return { state, decision: { decision: 'READY', reason: ready.reason }, idempotent: true };
  const preview = [...(draft?.aiPreviews ?? []), ...(story?.aiPreviews ?? [])].find((item) => item.operationId === body.operationId);
  return preview ? { state, preview, idempotent: true } : null;
}

async function saveDraft(db: D1Database, userId: string, state: AppState, draft: CaptureDraft) {
  return saveAuthorState(db, userId, { ...state, captureDrafts: (state.captureDrafts ?? []).map((item) => item.id === draft.id ? draft : item), updatedAt: draft.updatedAt });
}

async function saveStory(db: D1Database, userId: string, state: AppState, story: Story) {
  return saveAuthorState(db, userId, { ...state, stories: state.stories.map((item) => item.id === story.id ? story : item), updatedAt: story.updatedAt });
}

function maxOutputTokens(kind: AIOperationKind) { return kind === 'assembly' || kind === 'rephrase' ? 2400 : 800; }

function safeFailureCode(error: unknown) {
  if (error instanceof AliceAIProviderError) return error.code;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('lexical anchors')) return 'output_safety_failed';
  if (message.includes('source') || message.includes('provenance')) return 'provenance_validation_failed';
  if (error instanceof StateConflictError) return 'state_conflict';
  return 'post_provider_processing_failed';
}

async function reserveConnected(input: { config: AliceTrialConfig; provider: AliceAIProvider; db: D1Database; userId: string; body: GenerateBody; contextJson: string; sourceIds: string[]; baseRevisionId?: string }) {
  const existing = await findAiOperation(input.db, input.body.operationId, input.userId);
  if (existing) throw new Error(existing.status === 'uncertain' ? 'AI_OPERATION_UNCERTAIN' : 'AI_OPERATION_ALREADY_RESERVED');
  const reservation = await reserveAiOperation({
    db: input.db, operationId: input.body.operationId, userId: input.userId, kind: input.body.action, provider: input.provider.id, model: input.config.model,
    storyId: input.body.storyId, captureDraftId: input.body.captureDraftId, baseRevisionId: input.baseRevisionId, sourceIds: input.sourceIds, qaNonpersonalVerified: true,
    maxCostRub: estimateAiMaxCostRub({ inputCharacters: input.contextJson.length + 5000, maxOutputTokens: maxOutputTokens(input.body.action) }, input.config),
    workingCapRub: input.config.workingCapRub, absoluteCapRub: input.config.absoluteCapRub,
  });
  if (!reservation.claimed) throw new Error(reservation.operation ? 'AI_OPERATION_ALREADY_RESERVED' : 'AI_BUDGET_EXHAUSTED');
}

export async function handleAIOperation(
  request: NextRequest,
  runtimeEnv: Cloudflare.Env,
  options?: { userId?: string; db?: D1Database; forceDeterministic?: boolean; allowSyntheticFixtures?: boolean; liveBeta?: boolean },
) {
  const userId = options?.userId ?? authenticatedUserId(request.headers, request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1');
  if (!userId) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const db = options?.db ?? runtimeEnv.DB;
  const body = await request.json() as GenerateBody | MutationBody;
  if (!validId(body.operationId)) return NextResponse.json({ error: 'invalid_operation_id' }, { status: 400 });
  if (options?.forceDeterministic && !options.allowSyntheticFixtures && !['apply-preview','keep-original','undo'].includes(body.action)) {
    return NextResponse.json({ error:'semantic_ai_unavailable', message:'Сборка истории ИИ сейчас не подключена в этой тестовой версии. Исходные материалы сохранены.' }, { status:503 });
  }
  let reservedConnectedOperationId: string | null = null;
  let reservedConfig: AliceTrialConfig | null = null;
  let reservedLiveOperationId: string | null = null;
  let reservedLiveConfig: LiveBetaConfig | null = null;
  let liveProviderCalled = false;
  let providerUsage: { inputTokens: number; outputTokens: number } | null = null;
  try {
    let state = await loadAuthorState(db, userId);
    if (!state) return NextResponse.json({ error: 'book_not_found' }, { status: 404 });

    if (body.action === 'apply-preview' || body.action === 'keep-original' || body.action === 'undo') {
      return handleMutation(db, userId, state, body);
    }
    const generate = body as GenerateBody;

    const existingResult = findExistingResult(state, generate);
    if (existingResult) {
      const operation = options?.liveBeta ? await findLiveBetaOperation(db, generate.operationId) : await findAiOperation(db, generate.operationId, userId);
      return NextResponse.json({
        ...existingResult,
        provider: operation?.provider,
        model: operation?.model,
        usage: operation ? { inputTokens: operation.input_tokens ?? 0, outputTokens: operation.output_tokens ?? 0 } : undefined,
        actualCostRub: operation?.actual_cost_microrub != null ? operation.actual_cost_microrub / 1_000_000 : 0,
      });
    }
    const draft = body.captureDraftId ? state.captureDrafts?.find((item) => item.id === body.captureDraftId) : undefined;
    const story = body.storyId ? state.stories.find((item) => item.id === body.storyId) : undefined;
    if ((body.action === 'interview-next' || body.action === 'assembly') && !draft) return NextResponse.json({ error: 'capture_draft_not_found' }, { status: 404 });
    if ((body.action === 'rephrase' || body.action === 'patch') && !story && !draft?.assembledDraft) return NextResponse.json({ error: 'story_not_found' }, { status: 404 });
    if (generate.action === 'patch' && (!generate.expectedOldText?.trim() || !generate.instruction?.trim())) return NextResponse.json({ error: 'patch_input_required' }, { status: 400 });
    const owner = (draft ?? story)!;
    const storyTarget = story ?? draft?.assembledDraft;
    const context = body.action === 'interview-next' || body.action === 'assembly' ? contextForCaptureDraft(draft!) : contextForStory(storyTarget!);
    if (generate.narrativeStyle !== undefined && !isNarrativeStyle(generate.narrativeStyle)) return NextResponse.json({ error: 'invalid_narrative_style' }, { status: 400 });
    if (body.action === 'rephrase') context.narrativeStyle = isNarrativeStyle(generate.narrativeStyle) ? generate.narrativeStyle : 'natural';
    if (!context.sources.length) return NextResponse.json({ error: 'confirmed_sources_required' }, { status: 409 });
    if (body.action === 'interview-next' && (draft!.interviewQuestions?.length ?? 0) >= 8) return NextResponse.json({ state, decision: { decision: 'READY', reason: 'Достигнут аварийный предел восьми вопросов.' } });

    const liveConfig = options?.liveBeta ? readLiveBetaConfig(runtimeEnv) : null;
    if (options?.liveBeta && !liveConfig) return NextResponse.json({ error: 'live_beta_not_configured', message: 'Живой ИИ временно выключен: защищённая конфигурация не прошла проверку.' }, { status: 503 });
    if (options?.liveBeta && owner.externalProcessingPolicy !== 'user-content-approved') return NextResponse.json({ error: 'consent_required', message: 'Перед отправкой текста нужно подтвердить внешнюю обработку Yandex AI Studio.' }, { status: 403 });
    const config = options?.forceDeterministic || options?.liveBeta ? null : readAliceTrialConfig(runtimeEnv);
    const connected = options?.liveBeta ? Boolean(liveConfig) : !options?.forceDeterministic && canUseAliceTrial(config, owner.externalProcessingPolicy, userId, request.nextUrl.hostname);
    const provider: AIProvider = options?.liveBeta
      ? new YandexRealtimeAIProvider(liveConfig!, { db, userId, operationId: body.operationId })
      : connected ? new AliceAIProvider(config!, { db, userId, operationId: body.operationId }) : new DeterministicAIProvider();
    if (connected) {
      if (options?.liveBeta) {
        const previous = await findLiveBetaOperation(db, body.operationId);
        if (previous) return NextResponse.json({ error: 'ai_operation_already_reserved', status: previous.status, message: 'Этот платный вызов уже учтён и автоматически не повторяется.' }, { status: 409 });
        const reservation = await reserveLiveBetaOperation({
          db, operationId: body.operationId, userId, kind: body.action, model: liveConfig!.model,
          sourceId: body.storyId ?? body.captureDraftId, consentVersion: LIVE_BETA_CONSENT_VERSION,
          maxCostRub: estimateTextOperationMaxRub(JSON.stringify(context).length + 5_000, maxOutputTokens(body.action), liveConfig!),
        });
        if (!reservation.claimed) throw new Error(reservation.blockedByUnresolved ? 'LIVE_BETA_RETRY_BLOCKED' : 'LIVE_BETA_BUDGET_EXHAUSTED');
        reservedLiveOperationId = body.operationId;
        reservedLiveConfig = liveConfig;
      } else {
      const previousOperation = await findAiOperation(db, body.operationId, userId);
      if (previousOperation) {
        return NextResponse.json({
          error: previousOperation.status === 'failed' ? 'ai_operation_failed_known' : 'ai_operation_uncertain',
          status: previousOperation.status,
          failureCode: previousOperation.error_code,
          usage: { inputTokens: previousOperation.input_tokens ?? 0, outputTokens: previousOperation.output_tokens ?? 0 },
          actualCostRub: previousOperation.actual_cost_microrub == null ? null : previousOperation.actual_cost_microrub / 1_000_000,
          maxReservationRub: previousOperation.max_cost_microrub / 1_000_000,
          message: previousOperation.status === 'failed'
            ? 'Предыдущий вызов завершился известной ошибкой и не был применён. Повтор возможен только как новое явное действие с новым operationId.'
            : 'Исход предыдущего платного вызова нельзя подтвердить. Автоматический повтор заблокирован.',
        }, { status: 409 });
      }
      await reserveConnected({ config: config!, provider: provider as AliceAIProvider, db, userId, body: generate, contextJson: JSON.stringify(context), sourceIds: context.sources.map((source) => source.id), baseRevisionId: context.currentRevisionId });
      reservedConnectedOperationId = body.operationId;
      reservedConfig = config;
      }
    }

    let result: AIProviderResult<unknown>;
    try {
      if (reservedLiveOperationId) {
        await noteLiveBetaProviderCall(db, reservedLiveOperationId);
        liveProviderCalled = true;
      }
      if (body.action === 'interview-next') result = await provider.nextInterviewStep(context);
      else if (body.action === 'assembly') result = await provider.assemble(context);
      else if (body.action === 'rephrase') result = await provider.rephrase(context);
      else result = await provider.patch(context, { expectedOldText: generate.expectedOldText!, instruction: generate.instruction! });
    } catch (error) {
      if (error instanceof AliceAIProviderError && error.usage) providerUsage = error.usage;
      if (error instanceof YandexRealtimeError && hasFinalRealtimeBilling(error) && error.usage) providerUsage = { inputTokens: error.usage.inputTokens ?? 0, outputTokens: error.usage.outputTokens ?? 0 };
      throw error;
    }
    providerUsage = result.usage;

    let preview: AIStoryPreview | undefined;
    let decision: Record<string, unknown> | undefined;
    if (body.action === 'interview-next') {
      const applied = appendInterviewDecision(draft!, body.operationId, provider.id, result as Awaited<ReturnType<AIProvider['nextInterviewStep']>>);
      let nextDraft = applied.draft;
      if (applied.decision.decision === 'READY') {
        const now = new Date().toISOString();
        nextDraft = { ...nextDraft, aiReadyDecisions: [...(nextDraft.aiReadyDecisions ?? []), { operationId: body.operationId, reason: applied.decision.reason, provider: provider.id, model: result.model, createdAt: now }], updatedAt: now };
      }
      state = await saveDraft(db, userId, state, nextDraft);
      decision = applied.decision as unknown as Record<string, unknown>;
    } else if (body.action === 'assembly') {
      preview = makeAssemblyPreview(draft!, body.operationId, provider.id, result as Awaited<ReturnType<AIProvider['assemble']>>);
      state = await saveDraft(db, userId, state, { ...draft!, aiPreviews: [...(draft!.aiPreviews ?? []), preview], updatedAt: preview.createdAt });
    } else if (body.action === 'rephrase') {
      preview = makeRephrasePreview(storyTarget!, body.operationId, provider.id, result as Awaited<ReturnType<AIProvider['rephrase']>>);
      if (story) state = await saveStory(db, userId, state, { ...story, aiPreviews: [...(story.aiPreviews ?? []), preview], updatedAt: preview.createdAt });
      else state = await saveDraft(db, userId, state, { ...draft!, aiPreviews: [...(draft!.aiPreviews ?? []), preview], assembledDraft: { ...storyTarget!, aiPreviews: [...(storyTarget!.aiPreviews ?? []), preview] }, updatedAt: preview.createdAt });
    } else {
      preview = makePatchPreview(storyTarget!, body.operationId, provider.id, result as Awaited<ReturnType<AIProvider['patch']>>);
      if (story) state = await saveStory(db, userId, state, { ...story, aiPreviews: [...(story.aiPreviews ?? []), preview], updatedAt: preview.createdAt });
      else state = await saveDraft(db, userId, state, { ...draft!, aiPreviews: [...(draft!.aiPreviews ?? []), preview], assembledDraft: { ...storyTarget!, aiPreviews: [...(storyTarget!.aiPreviews ?? []), preview] }, updatedAt: preview.createdAt });
    }
    const actualCost = options?.liveBeta && reservedLiveConfig
      ? liveBetaCostRub({ inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }, reservedLiveConfig)
      : connected ? actualAiCostRub(result.usage.inputTokens, result.usage.outputTokens, config!) : 0;
    if (reservedLiveOperationId && reservedLiveConfig) {
      await completeLiveBetaOperation({
        db,
        operationId: reservedLiveOperationId,
        actualCostRub: actualCost,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        providerSessionId: (provider as YandexRealtimeAIProvider).lastProviderSessionId,
      });
      reservedLiveOperationId = null;
    }
    if (connected) {
      if (!options?.liveBeta) {
        await completeAiOperation({ db, operationId: body.operationId, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, actualCostRub: actualCost, previewId: preview?.id ?? `question:${body.operationId}` });
        reservedConnectedOperationId = null;
      }
    }
    return NextResponse.json({ state, provider: provider.id, mode: provider.mode, model: result.model, usage: result.usage, actualCostRub: actualCost, ...(decision ? { decision } : { preview }) });
  } catch (error) {
    if (reservedLiveOperationId) {
      try {
        const realtime = error instanceof YandexRealtimeError ? error : null;
        const billingFinal = realtime ? hasFinalRealtimeBilling(realtime) : Boolean(providerUsage);
        const usage = realtime && billingFinal ? realtime.usage : providerUsage ? { inputTokens: providerUsage.inputTokens, outputTokens: providerUsage.outputTokens } : undefined;
        const actualCostRub = usage && reservedLiveConfig ? liveBetaCostRub(usage, reservedLiveConfig) : undefined;
        await failLiveBetaOperation({ db, operationId: reservedLiveOperationId, errorCode: realtime?.code ?? safeFailureCode(error), uncertain: liveProviderCalled && !billingFinal, actualCostRub, usage, providerSessionId: realtime?.providerSessionId });
      } catch { /* The reservation remains a conservative hard-cap hold. */ }
    }
    if (reservedConnectedOperationId) {
      try {
        const failureCode = safeFailureCode(error);
        if (providerUsage && reservedConfig) await failAiOperation({ db, operationId: reservedConnectedOperationId, errorCode: failureCode, ...providerUsage, actualCostRub: actualAiCostRub(providerUsage.inputTokens, providerUsage.outputTokens, reservedConfig) });
        else await markAiOperationUncertain(db, reservedConnectedOperationId, failureCode);
      } catch { /* Preserve the original failure; the reservation still blocks reuse. */ }
    }
    if (error instanceof StateConflictError) return NextResponse.json({ error: 'conflict', message: 'История изменилась в другой вкладке. Новый AI-вызов не выполнен.' }, { status: 409 });
    const code = error instanceof Error ? error.message : 'ai_operation_failed';
    if (code === 'AI_OPERATION_UNCERTAIN' || code === 'AI_OPERATION_ALREADY_RESERVED') return NextResponse.json({ error: code.toLowerCase(), message: 'Исход предыдущего платного вызова нельзя подтвердить. Автоматический повтор заблокирован.' }, { status: 409 });
    if (code === 'AI_BUDGET_EXHAUSTED') return NextResponse.json({ error: 'ai_budget_exhausted', message: 'Рабочий лимит AI trial 60 ₽ исчерпан. Новый вызов не выполнен.' }, { status: 402 });
    if (code === 'LIVE_BETA_BUDGET_EXHAUSTED') return NextResponse.json({ error: 'live_beta_budget_exhausted', message: 'Жёсткий лимит Closed Beta 100 ₽ не позволяет начать новый вызов.' }, { status: 402 });
    if (code === 'LIVE_BETA_RETRY_BLOCKED') return NextResponse.json({ error: 'live_beta_retry_blocked', message: 'Предыдущий вызов для этого материала имеет незавершённый или неоднозначный исход. Новый платный вызов заблокирован.' }, { status: 409 });
    return NextResponse.json({ error: 'ai_operation_failed', failureCode: safeFailureCode(error), message: 'AI-предложение не создано. Исходный материал и все версии сохранены; платный вызов не повторяется автоматически.' }, { status: 502 });
  }
}

async function handleMutation(db: D1Database, userId: string, state: AppState, body: MutationBody) {
  if (body.captureDraftId) {
    const draft = state.captureDrafts?.find((item) => item.id === body.captureDraftId);
    if (!draft) return NextResponse.json({ error: 'capture_draft_not_found' }, { status: 404 });
    let next: CaptureDraft;
    if (body.action === 'undo') {
      if (!draft.assembledDraft) return NextResponse.json({ error: 'draft_story_not_found' }, { status: 409 });
      const assembledDraft = undoLatestStoryTextChange(draft.assembledDraft, body.operationId);
      next = { ...draft, assembledDraft, updatedAt: assembledDraft.updatedAt };
    } else {
      if (!body.previewId) return NextResponse.json({ error: 'preview_not_found' }, { status: 404 });
      const preview = draft.aiPreviews?.find((item) => item.id === body.previewId);
      if (!preview) return NextResponse.json({ error: 'preview_not_found' }, { status: 404 });
      if (body.action === 'apply-preview' && preview.type === 'assembly') next = applyAssemblyPreview(draft, body.previewId);
      else if (body.action === 'apply-preview') {
        if (!draft.assembledDraft) return NextResponse.json({ error: 'draft_story_not_found' }, { status: 409 });
        const assembledDraft = applyStoryPreview({ ...draft.assembledDraft, aiPreviews: draft.aiPreviews }, body.previewId);
        next = { ...draft, assembledDraft, aiPreviews: assembledDraft.aiPreviews, updatedAt: assembledDraft.updatedAt };
      } else {
        const kept = keepOriginalPreview(draft, body.previewId);
        next = { ...kept, assembledDraft: kept.assembledDraft ? { ...kept.assembledDraft, aiPreviews: kept.aiPreviews } : kept.assembledDraft };
      }
    }
    const saved = await saveDraft(db, userId, state, next);
    const preview = body.previewId ? next.aiPreviews?.find((item) => item.id === body.previewId) : undefined;
    if (preview?.createdRevisionId) await linkAiOperationRevision(db, userId, preview.operationId, preview.createdRevisionId);
    return NextResponse.json({ state: saved, preview });
  }
  const story = body.storyId ? state.stories.find((item) => item.id === body.storyId) : undefined;
  if (!story) return NextResponse.json({ error: 'story_not_found' }, { status: 404 });
  let next: Story;
  if (body.action === 'undo') next = undoLatestStoryTextChange(story, body.operationId);
  else if (!body.previewId) return NextResponse.json({ error: 'preview_id_required' }, { status: 400 });
  else next = body.action === 'apply-preview' ? applyStoryPreview(story, body.previewId) : keepOriginalPreview(story, body.previewId);
  const saved = await saveStory(db, userId, state, next);
  const preview = body.previewId ? next.aiPreviews?.find((item) => item.id === body.previewId) : undefined;
  if (preview?.createdRevisionId) await linkAiOperationRevision(db, userId, preview.operationId, preview.createdRevisionId);
  return NextResponse.json({ state: saved, preview, revision: next.revisions.at(-1) });
}
