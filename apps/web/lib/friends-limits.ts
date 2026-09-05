export const FRIENDS_BETA_LIMITS = {
  totalAudioBytes: 500_000_000,
  singleAudioBytes: 16_000_000,
  singleAudioDurationMs: 180_000,
  voicePerSessionPerDay: 5,
  feedbackPerSessionPerDay: 50,
  classAPerMonth: 50_000,
  classBPerMonth: 250_000,
  loginAttemptsPerWindow: 8,
  loginWindowMs: 15 * 60 * 1_000,
  testerSessionTtlSeconds: 7 * 24 * 60 * 60,
  ownerSessionTtlSeconds: 12 * 60 * 60,
} as const;

export const FEEDBACK_CATEGORIES = ['improvement', 'error', 'inconvenience', 'idea'] as const;
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];

export function utcMonthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

export function utcDayStart(now = new Date()) {
  return now.toISOString().slice(0, 10) + 'T00:00:00.000Z';
}
