import type { AIAssemblyProposal, AIInterviewDecision, AIRephraseProposal } from './adapters';
import type { AITargetedPatch, InterviewQuestionCategory } from './domain';

type JsonObject = Record<string, unknown>;

const sourceIdsSchema = { type: 'array', items: { type: 'string' }, maxItems: 64 } as const;
const requiredSourceIdsSchema = { ...sourceIdsSchema, minItems: 1 } as const;

export const AI_RESPONSE_SCHEMAS = {
  interview: {
    type: 'object', additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: ['ASK', 'READY'] },
      question: { type: 'string' },
      anchorQuote: { type: 'string' },
      category: { type: 'string', enum: ['gap', 'contradiction', 'meaning', 'detail', 'change', 'people', 'time-place'] },
      purpose: { type: 'string' },
      relatedSourceIds: sourceIdsSchema,
      reason: { type: 'string' },
    },
    required: ['decision', 'question', 'anchorQuote', 'category', 'purpose', 'relatedSourceIds', 'reason'],
  },
  assembly: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' }, storyText: { type: 'string' },
      provenance: {
        type: 'array', maxItems: 128, items: {
          type: 'object', additionalProperties: false,
          properties: { segment: { type: 'string' }, sourceIds: requiredSourceIdsSchema },
          required: ['segment', 'sourceIds'],
        },
      },
      uncertainties: { type: 'array', items: { type: 'string' }, maxItems: 32 },
    },
    required: ['title', 'storyText', 'provenance', 'uncertainties'],
  },
  rephrase: {
    type: 'object', additionalProperties: false,
    properties: { storyText: { type: 'string' }, sourceIds: requiredSourceIdsSchema, reason: { type: 'string' } },
    required: ['storyText', 'sourceIds', 'reason'],
  },
  patch: {
    type: 'object', additionalProperties: false,
    properties: {
      expectedOldText: { type: 'string' }, replacementText: { type: 'string' }, reason: { type: 'string' }, sourceIds: requiredSourceIdsSchema,
    },
    required: ['expectedOldText', 'replacementText', 'reason', 'sourceIds'],
  },
} as const;

type SourceIdItems = { type: string; enum?: string[] };
type MutableResponseSchema = {
  properties: {
    relatedSourceIds?: { items: SourceIdItems };
    provenance?: { items: { properties: { sourceIds: { items: SourceIdItems } } } };
    sourceIds?: { items: SourceIdItems };
    expectedOldText?: { type: string; const?: string };
  };
};

export function responseSchemaFor(kind: keyof typeof AI_RESPONSE_SCHEMAS, allowedSourceIds: string[], expectedOldText?: string) {
  const schema = JSON.parse(JSON.stringify(AI_RESPONSE_SCHEMAS[kind])) as MutableResponseSchema;
  const exactItems = { type: 'string', enum: [...allowedSourceIds] };
  if (kind === 'interview') schema.properties.relatedSourceIds!.items = exactItems;
  else if (kind === 'assembly') schema.properties.provenance!.items.properties.sourceIds.items = exactItems;
  else schema.properties.sourceIds!.items = exactItems;
  if (kind === 'patch' && expectedOldText) schema.properties.expectedOldText!.const = expectedOldText;
  return schema;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}

function string(value: unknown, label: string, max = 40_000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be a bounded string.`);
  return value;
}

function strings(value: unknown, label: string, maxItems = 64) {
  if (!Array.isArray(value) || value.length > maxItems || !value.every((item) => typeof item === 'string')) throw new Error(`${label} must be a bounded string array.`);
  return value as string[];
}

function exactKeys(value: JsonObject, allowed: string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value))) throw new Error(`${label} has an invalid shape.`);
}

export function parseInterviewDecision(value: unknown): AIInterviewDecision {
  const item = object(value, 'Interview decision');
  exactKeys(item, ['decision', 'question', 'anchorQuote', 'category', 'purpose', 'relatedSourceIds', 'reason'], 'Interview decision');
  const decision = string(item.decision, 'decision', 5);
  const question = string(item.question, 'question', 500).trim();
  const anchorQuote = string(item.anchorQuote, 'anchorQuote', 300).trim();
  const purpose = string(item.purpose, 'purpose', 500).trim();
  const reason = string(item.reason, 'reason', 500).trim();
  const relatedSourceIds = strings(item.relatedSourceIds, 'relatedSourceIds');
  const categories: InterviewQuestionCategory[] = ['gap', 'contradiction', 'meaning', 'detail', 'change', 'people', 'time-place'];
  const category = string(item.category, 'category', 32) as InterviewQuestionCategory;
  if (!categories.includes(category)) throw new Error('Interview category is not allowed.');
  if (decision === 'ASK') {
    if (!question || !anchorQuote || !purpose || !relatedSourceIds.length) throw new Error('ASK requires one purposeful question, an anchor quote and related sources.');
    return { decision, question, anchorQuote, category, purpose, relatedSourceIds };
  }
  if (decision === 'READY') {
    if (!reason) throw new Error('READY requires a reason.');
    return { decision, reason };
  }
  throw new Error('Interview decision must be ASK or READY.');
}

export function parseAssemblyProposal(value: unknown): AIAssemblyProposal {
  const item = object(value, 'Assembly proposal');
  exactKeys(item, ['title', 'storyText', 'provenance', 'uncertainties'], 'Assembly proposal');
  if (!Array.isArray(item.provenance) || item.provenance.length > 128) throw new Error('provenance must be a bounded array.');
  const provenance = item.provenance.map((raw) => {
    const segment = object(raw, 'provenance segment');
    exactKeys(segment, ['segment', 'sourceIds'], 'provenance segment');
    return { segment: string(segment.segment, 'segment').trim(), sourceIds: strings(segment.sourceIds, 'sourceIds') };
  });
  const result = {
    title: string(item.title, 'title', 200).trim(), storyText: string(item.storyText, 'storyText').trim(),
    provenance, uncertainties: strings(item.uncertainties, 'uncertainties', 32),
  };
  if (!result.title || !result.storyText || !result.provenance.length) throw new Error('Assembly proposal is incomplete.');
  return result;
}

export function parseRephraseProposal(value: unknown): AIRephraseProposal {
  const item = object(value, 'Rephrase proposal');
  exactKeys(item, ['storyText', 'sourceIds', 'reason'], 'Rephrase proposal');
  const result = { storyText: string(item.storyText, 'storyText').trim(), sourceIds: strings(item.sourceIds, 'sourceIds'), reason: string(item.reason, 'reason', 1000).trim() };
  if (!result.storyText || !result.sourceIds.length || !result.reason) throw new Error('Rephrase proposal is incomplete.');
  return result;
}

export function parseTargetedPatch(value: unknown): AITargetedPatch {
  const item = object(value, 'Targeted patch');
  exactKeys(item, ['expectedOldText', 'replacementText', 'reason', 'sourceIds'], 'Targeted patch');
  const result = {
    expectedOldText: string(item.expectedOldText, 'expectedOldText').trim(), replacementText: string(item.replacementText, 'replacementText').trim(),
    reason: string(item.reason, 'reason', 1000).trim(), sourceIds: strings(item.sourceIds, 'sourceIds'),
  };
  if (!result.expectedOldText || !result.replacementText || !result.reason || !result.sourceIds.length) throw new Error('Targeted patch is incomplete.');
  return result;
}
