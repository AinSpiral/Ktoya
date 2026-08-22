export type StorySourceKind = 'typed' | 'transcript' | 'interview-answer' | 'manual-edit';
export type StoryStyle = 'natural' | 'warm' | 'concise' | 'documentary';
export type PrivacyLevel = 'private' | 'selected' | 'book';

export interface StorySource {
  id: string;
  kind: StorySourceKind;
  text: string;
  createdAt: string;
}

export interface Transcript {
  text: string;
  provider: 'browser-speech-recognition' | 'manual';
  confirmed: boolean;
}

export interface InterviewAnswer {
  id: string;
  question: string;
  answer: string;
}

export interface Revision {
  id: string;
  text: string;
  createdAt: string;
  reason: 'assembled' | 'manual-edit';
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
  audioKey?: string;
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
  version: 1;
  author: Author | null;
  book: Book;
  stories: Story[];
  style: StoryStyle;
  bookPrivacy: PrivacyLevel;
  trial: TrialState;
  subscription: SubscriptionState;
  aiBalance: AIBalance;
  updatedAt: string;
}

export interface FeedbackEntry {
  id: string;
  type: 'improvement' | 'error' | 'inconvenience' | 'idea';
  text: string;
  createdAt: string;
}

export function createEmptyState(): AppState {
  const now = new Date().toISOString();
  return {
    version: 1,
    author: null,
    book: { id: crypto.randomUUID(), title: 'Моя Книга жизни', storyIds: [], createdAt: now, updatedAt: now },
    stories: [],
    style: 'natural',
    bookPrivacy: 'private',
    trial: { startedAt: null, endsAt: null, status: 'not-started' },
    subscription: { status: 'none', planName: 'Книга жизни', priceRub: 490 },
    aiBalance: { includedMinutes: 120, usedMinutes: 0 },
    updatedAt: now,
  };
}
