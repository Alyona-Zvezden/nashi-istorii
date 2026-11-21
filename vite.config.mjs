import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const base = process.env.BASE_PATH || '/nashi-istorii/';
if (!/^\/[a-zA-Z0-9_-]+\/$/.test(base)) throw new Error('BASE_PATH должен быть /repository/');
const buildId = process.env.APP_BUILD_ID || createHash('sha256')
  .update(String(Date.now()) + readFileSync('package.json')).digest('hex').slice(0, 12);
export default defineConfig({
  base,
  plugins: [{
    name: 'release-metadata',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'app-release', content: buildId }, injectTo: 'head' }];
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ buildId, base }) });
    },
  }],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __DB_NAME__: JSON.stringify('nashi-istorii:' + base.slice(1, -1)),
  },
  build: {
    target: 'es2022', sourcemap: false, outDir: process.env.OUT_DIR || 'dist',
    rollupOptions: {
      input: { app: 'index.html', worker: 'src/offline/sw.js' },
      output: { entryFileNames: chunk => chunk.name === 'worker' ? 'sw.js' : 'assets/[name]-[hash].js' },
    },
  },
});
