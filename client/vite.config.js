import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Fills in public/sw.js after the build: the list of files to cache for offline start, and a build id
 * that changes whenever any of them does, so each deploy gets a fresh cache and the old one is dropped.
 */
function serviceWorker() {
  let outDir;
  let assets = [];
  let failed = false;
  return {
    name: 'kickoff-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
        .map((file) => `/${file}`)
        .sort();
    },
    buildEnd(error) {
      failed = Boolean(error);
    },
    closeBundle() {
      if (failed) return;
      const file = path.join(outDir, 'sw.js');
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('__BUILD_ID__') || !source.includes('__PRECACHE__')) {
        throw new Error('sw.js is missing its __BUILD_ID__ / __PRECACHE__ placeholders');
      }
      const precache = ['/', ...assets];
      const buildId = crypto.createHash('sha1').update(source).update(precache.join('\n')).digest('hex').slice(0, 10);
      fs.writeFileSync(
        file,
        source.replace('__BUILD_ID__', () => buildId).replace('__PRECACHE__', () => JSON.stringify(precache)),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: { '/api': 'http://localhost:5050' },
  },
  build: {
    chunkSizeWarningLimit: 700, // hls.js is large by nature
  },
});
