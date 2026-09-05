import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// Dedicated TEST-only build path. It intentionally omits the Sites plugin and
// the production DB/STORY_MEDIA bindings declared in .openai/hosting.json.
export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/friends-beta-logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/friends-beta-registry';
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    plugins: [
      vinext(),
      cloudflare({
        configPath: fileURLToPath(new URL('./wrangler.friends-beta.jsonc', import.meta.url)),
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        remoteBindings: false,
      }),
    ],
  };
});
