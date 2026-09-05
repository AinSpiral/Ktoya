import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vinext from 'vinext';
import tailwindcss from '@tailwindcss/postcss';

// Separate config directory means the developer's .dev.vars is never loaded.
// No Sites deployment plugin, remote bindings, credentials, or shared QA data.
export default defineConfig(async () => {
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  process.env.WRANGLER_WRITE_LOGS = 'false';
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    css: { postcss: { plugins: [tailwindcss()] } },
    plugins: [vinext(), cloudflare({
      configPath: fileURLToPath(new URL('./wrangler.json', import.meta.url)),
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      persistState: { path: fileURLToPath(new URL('./.generated/state', import.meta.url)) },
      remoteBindings: false,
      inspectorPort: false,
    })],
  };
});
