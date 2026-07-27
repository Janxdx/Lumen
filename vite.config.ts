import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Stamps the built asset list and a build id into the service worker, so the
 * offline shell precaches the real hashed bundles at install rather than
 * hoping they were fetched once while online. Keeps us off workbox.
 */
function serviceWorkerAssets(): Plugin {
  return {
    name: 'sw-assets',
    apply: 'build',
    closeBundle() {
      const outDir = fileURLToPath(new URL('./dist', import.meta.url));
      const swPath = join(outDir, 'sw.js');

      let assets: string[] = [];
      try {
        assets = readdirSync(join(outDir, 'assets')).map((f) => `/assets/${f}`);
      } catch {
        /* no assets dir — nothing to precache beyond the shell */
      }

      let sw: string;
      try {
        sw = readFileSync(swPath, 'utf8');
      } catch {
        return; // public/sw.js absent; offline support is optional
      }

      const stamped = sw
        .replace("'__BUILD__'", JSON.stringify(Date.now().toString(36)))
        .replace("['__ASSETS__']", JSON.stringify(assets));

      writeFileSync(swPath, stamped);
      console.log(`sw.js: precaching ${assets.length} built assets`);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerAssets()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
});
