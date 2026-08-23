declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      STORY_MEDIA: R2Bucket;
      YANDEX_SPEECHKIT_API_KEY?: string;
      KTOYA_SPEECHKIT_TRIAL_ENABLED?: string;
      KTOYA_SPEECHKIT_KEY_EXPIRES_AT?: string;
      KTOYA_SPEECHKIT_KEY_SCOPES?: string;
      KTOYA_SPEECHKIT_IAM_VERIFIED_AT?: string;
      KTOYA_SPEECHKIT_TARIFF_VERIFIED_AT?: string;
      KTOYA_SPEECHKIT_STT_RUB_PER_SECOND?: string;
      KTOYA_SPEECHKIT_TTS_RUB_PER_UNIT?: string;
      KTOYA_SPEECHKIT_TRIAL_CAP_RUB?: string;
      KTOYA_SPEECHKIT_DEFAULT_TTS_VOICE?: string;
    }
  }

  interface Env {
    DB: D1Database;
    STORY_MEDIA: R2Bucket;
    YANDEX_SPEECHKIT_API_KEY?: string;
    KTOYA_SPEECHKIT_TRIAL_ENABLED?: string;
    KTOYA_SPEECHKIT_KEY_EXPIRES_AT?: string;
    KTOYA_SPEECHKIT_KEY_SCOPES?: string;
    KTOYA_SPEECHKIT_IAM_VERIFIED_AT?: string;
    KTOYA_SPEECHKIT_TARIFF_VERIFIED_AT?: string;
    KTOYA_SPEECHKIT_STT_RUB_PER_SECOND?: string;
    KTOYA_SPEECHKIT_TTS_RUB_PER_UNIT?: string;
    KTOYA_SPEECHKIT_TRIAL_CAP_RUB?: string;
    KTOYA_SPEECHKIT_DEFAULT_TTS_VOICE?: string;
  }
}

export {};
