export type StorySourceKind = 'typed' | 'transcript' | 'interview-answer' | 'manual-edit' | 'imported-draft';
export type StoryStyle = 'natural' | 'warm' | 'concise' | 'documentary';
export type PrivacyLevel = 'private' | 'selected' | 'book';
export type ChapterKind = 'life-stories' | 'imported-manuscript';
export type TranscriptProviderKind = 'browser-speech-recognition' | 'manual' | 'production-stt' | 'ai-enhancement';
export type TranscriptRevisionKind = 'raw' | 'improved';
export type VoiceJobStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type ExternalVoiceProcessingPolicy = 'qa-nonpersonal-trial' | 'user-content-approved';
export type AudioDerivationKind = 'remux-ogg-opus' | 'transcode-pcm-wav';
export type TranscriptProcessingMode = 'faithful' | 'literature-derived';

/** A provider input is a new technical asset; the immutable browser original remains authoritative. */
export interface DerivedAudioAsset {
  id: string;
  sourceAudioFragmentId: string;
  purpose: 'stt-input';
  objectKey: string;
  contentType: 'audio/ogg' | 'audio/wav' | 'audio/mpeg';
  derivation: AudioDerivationKind;
  createdAt: string;
  byteLength: number;
  durationMs: number;
}

export interface StorySource {
  id: string;
  kind: StorySourceKind;
  text: string;
  createdAt: string;
  /** Links a readable source to the immutable media it came from, when applicable. */
  audioFragmentId?: string;
  transcriptRevisionId?: string;
  /** Identifies the precise interview question that produced this source. */
  questionId?: string;
  /** Makes one user save operation idempotent without conflating equal prose. */
  editOperationId?: string;
}

export interface Transcript {
  text: string;
  provider: TranscriptProviderKind;
  confirmed: boolean;
}

/**
 * The original recording is an independent object.  A failed upload stays
 * visible to the author instead of being treated as a successfully saved file.
 */
export interface AudioFragment {
  id: string;
  position: number;
  createdAt: string;
  contentType: string;
  /** `deleted` is read only for legacy records and is normalized to `saved` + archivedAt. */
  uploadStatus: 'pending' | 'saved' | 'failed' | 'deleted';
  objectKey?: string;
  uploadedAt?: string;
  /** Hiding only changes reader visibility; the original and text remain intact. */
  hiddenAt?: string;
  /** Author-controlled, reversible removal from the reader. Never deletes the R2 object. */
  archivedAt?: string;
  /** Legacy marker retained only while older local state is being normalized. */
  deletedAt?: string;
  /** Browser recognition failures are visible; a partial tail is never silently complete. */
  recognitionStatus?: 'processing' | 'complete' | 'incomplete' | 'unavailable';
  /** Measured locally and used for a conservative pre-call billing reservation. */
  durationMs?: number;
  /** Absent for all historical/personal material, which therefore cannot enter the trial provider. */
  externalProcessingPolicy?: ExternalVoiceProcessingPolicy;
  /** Append-only technical derivatives; never replace or delete the WebM/Opus original. */
  derivedAssets?: DerivedAudioAsset[];
}

/** A recognition attempt is append-only; one revision can be selected for reading. */
export interface TranscriptRevision {
  id: string;
  audioFragmentId: string;
  text: string;
  provider: TranscriptProviderKind;
  /** Raw browser output is immutable evidence; later processing creates an improved revision. */
  revisionKind: TranscriptRevisionKind;
  /** An improved transcript declares exactly which preserved version it was derived from. */
  basedOnRevisionId?: string;
  createdAt: string;
  selected: boolean;
  /** Browser recognition is a draft until the Author explicitly checks it. */
  verificationStatus?: 'unverified' | 'confirmed';
  completenessStatus?: 'complete' | 'incomplete' | 'unavailable';
  /** Faithful STT is canonical; literature output is always a separate non-destructive layer. */
  processingMode?: TranscriptProcessingMode;
}

/**
 * One immutable attempt to process an already saved recording. Attempts are
 * append-only so an outage or a later retry cannot erase either the audio or
 * an earlier result.
 */
export interface TranscriptionAttempt {
  id: string;
  audioFragmentId: string;
  provider: string;
  status: VoiceJobStatus;
  /** The preserved revision supplied as context, normally the raw browser draft. */
  basedOnRevisionId?: string;
  resultRevisionId?: string;
  externalJobId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string;
  /** Safe user-facing detail only; provider payloads and secrets are never stored here. */
  errorMessage?: string;
  processingMode?: TranscriptProcessingMode;
  derivedAudioAssetId?: string;
  /** Deterministic billable-operation key used to prevent accidental duplicate submission. */
  billingOperationId?: string;
}

export interface InterviewAnswer {
  id: string;
  questionId?: string;
  question: string;
  answer: string;
  createdAt?: string;
  audioFragmentId?: string;
  transcriptRevisionId?: string;
  /** All recordings are retained when one answer is captured in several takes. */
  audioFragmentIds?: string[];
  transcriptRevisionIds?: string[];
}

export interface StoryTitleRevision {
  id: string;
  title: string;
  provider: 'fallback' | 'manual' | 'ai';
  createdAt: string;
  selected: boolean;
}

/** A provider-produced narration is a real seekable asset, never a browser-voice imitation. */
export interface StoryNarration {
  id: string;
  provider: string;
  /** A narration is valid only for this exact, preserved StoryRevision. */
  storyRevisionId: string;
  status: VoiceJobStatus;
  objectKey?: string;
  contentType?: string;
  externalJobId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  voiceId?: string;
  errorCode?: string;
  errorMessage?: string;
  billingOperationId?: string;
}

/** Read-only compatibility shape from the pre-provider Beta. */
export interface LegacyStoryNarration {
  id: string;
  provider: 'production-tts';
  objectKey: string;
  contentType: string;
  createdAt: string;
}

/** Unsaved additions to an existing story survive reload independently of capture drafts. */
export interface StoryEditDraft {
  id: string;
  storyId: string;
  text: string;
  fragments: CaptureDraftFragment[];
  updatedAt: string;
}

/**
 * Capture drafts are separate from finished stories.  They are persisted as
 * soon as an author writes or records, so a reload cannot silently discard
 * an already uploaded original or its working transcript.
 */
export interface CaptureDraftFragment {
  fragment: AudioFragment;
  /** Immutable browser/debug evidence once recognition finishes. */
  rawTranscript?: string;
  /** Currently selected working text; manual edits never replace rawTranscript. */
  transcript: string;
  /** Persisted append-only history exists before the story is assembled. */
  transcriptRevisions?: TranscriptRevision[];
  /** Provider retries are preserved even when the author is still in capture/review. */
  transcriptionAttempts?: TranscriptionAttempt[];
}

export interface VoiceAnswerCaptureDraft {
  answerId: string;
  questionId: string;
  question: string;
  fragments: CaptureDraftFragment[];
}

export interface CaptureDraft {
  id: string;
  sourceText: string;
  answer: string;
  interviewAnswers: InterviewAnswer[];
  storyFragments: CaptureDraftFragment[];
  answerFragments: CaptureDraftFragment[];
  voiceAnswerDrafts: VoiceAnswerCaptureDraft[];
  /** The review-stage composition is saved separately from immutable source material. */
  assembledDraft?: Story;
  capturePurpose: 'story' | 'answer';
  externalProcessingPolicy?: ExternalVoiceProcessingPolicy;
  updatedAt: string;
}

export interface Revision {
  id: string;
  text: string;
  createdAt: string;
  reason: 'assembled' | 'manual-edit' | 'imported' | 'ai-suggestion-applied';
}

export interface Story {
  id: string;
  title: string;
  text: string;
  sourceMode: 'text' | 'voice';
  sources: StorySource[];
  transcript?: Transcript;
  interviewAnswers: InterviewAnswer[];
  revisions: Revision[];
  privacy: PrivacyLevel;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string;
  /** Optimistic-concurrency version maintained by the server. */
  recordVersion?: number;
  audioFragments?: AudioFragment[];
  transcriptRevisions?: TranscriptRevision[];
  transcriptionAttempts?: TranscriptionAttempt[];
  status?: 'draft' | 'confirmed';
  titleRevisions?: StoryTitleRevision[];
  narration?: LegacyStoryNarration;
  /** All generated assets are retained; text edits make older ones stale, not deleted. */
  narrations?: StoryNarration[];
  /** Kept only so a legacy record can be migrated without guessing data. */
  audioKey?: string;
  /** Explicit opt-in attached only to newly created nonpersonal trial stories. */
  externalProcessingPolicy?: ExternalVoiceProcessingPolicy;
}

export interface Author {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Book {
  id: string;
  title: string;
  storyIds: string[];
  chapterIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  title: string;
  kind: ChapterKind;
  storyIds: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrialState {
  startedAt: string | null;
  endsAt: string | null;
  status: 'not-started' | 'active' | 'ended';
}

export interface SubscriptionState {
  status: 'none' | 'demo';
  planName: string;
  priceRub: number;
}

export interface AIBalance {
  includedMinutes: number;
  usedMinutes: number;
}

export interface AppState {
  version: 3;
  author: Author | null;
  book: Book;
  chapters: Chapter[];
  stories: Story[];
  style: StoryStyle;
  bookPrivacy: PrivacyLevel;
  trial: TrialState;
  subscription: SubscriptionState;
  aiBalance: AIBalance;
  updatedAt: string;
  /** Unfinished material is intentionally outside the finished-book list. */
  captureDrafts?: CaptureDraft[];
  storyEditDrafts?: StoryEditDraft[];
  /** Version of book-level settings; stories have their own recordVersion. */
  stateVersion?: number;
}

export interface FeedbackEntry {
  id: string;
  type: 'improvement' | 'error' | 'inconvenience' | 'idea';
  text: string;
  createdAt: string;
}

export function createEmptyState(): AppState {
  const now = new Date().toISOString();
  const chapter: Chapter = {
    id: crypto.randomUUID(),
    title: 'Истории моей жизни',
    kind: 'life-stories',
    storyIds: [],
    position: 0,
    createdAt: now,
    updatedAt: now,
  };
  return {
    version: 3,
    author: null,
    book: { id: crypto.randomUUID(), title: 'Моя Книга жизни', storyIds: [], chapterIds: [chapter.id], createdAt: now, updatedAt: now },
    chapters: [chapter],
    stories: [],
    style: 'natural',
    bookPrivacy: 'private',
    trial: { startedAt: null, endsAt: null, status: 'not-started' },
    subscription: { status: 'none', planName: 'Книга жизни', priceRub: 490 },
    aiBalance: { includedMinutes: 120, usedMinutes: 0 },
    updatedAt: now,
  };
}

export function normalizeAppState(state: AppState): AppState {
  const legacy = state as AppState & { version: 1 | 2 | 3; chapters?: Chapter[]; book: Book & { chapterIds?: string[] } };
  const now = new Date().toISOString();
  const stories = state.stories.map((story) => {
    const fragments = story.audioFragments?.map((fragment) => {
      if (fragment.uploadStatus !== 'deleted') return fragment;
      // Previous Beta builds called this state “soft delete”. The object key
      // was never deleted from R2, so migrate it to the honest reversible
      // archive state rather than retaining a destructive user meaning.
      return {
        ...fragment,
        uploadStatus: 'saved' as const,
        archivedAt: fragment.archivedAt ?? fragment.deletedAt ?? fragment.hiddenAt ?? fragment.uploadedAt ?? fragment.createdAt ?? now,
        deletedAt: undefined,
      };
    });
    if (!fragments || fragments.every((fragment, index) => fragment === story.audioFragments?.[index])) return story;
    return { ...story, audioFragments: fragments };
  });
  const audioSafetyChanged = stories.some((story, index) => story !== state.stories[index]);
  if (legacy.version === 3 && legacy.chapters?.length && legacy.book.chapterIds?.length) {
    return audioSafetyChanged ? { ...state, stories } : state;
  }

  const chapter: Chapter = {
    id: crypto.randomUUID(),
    title: 'Истории моей жизни',
    kind: 'life-stories',
    storyIds: [...legacy.book.storyIds],
    position: 0,
    createdAt: legacy.book.createdAt ?? now,
    updatedAt: legacy.book.updatedAt ?? now,
  };
  return {
    ...state,
    stories,
    version: 3,
    book: { ...legacy.book, chapterIds: [chapter.id] },
    chapters: [chapter],
  };
}
