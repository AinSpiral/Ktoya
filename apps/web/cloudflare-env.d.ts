declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      STORY_MEDIA: R2Bucket;
    }
  }

  interface Env {
    DB: D1Database;
    STORY_MEDIA: R2Bucket;
  }
}

export {};
