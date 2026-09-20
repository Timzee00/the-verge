import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

function walkFiles(root: string, current = root): string[] {
  const entries = readdirSync(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, full));
    else files.push(full);
  }
  return files;
}

function generateOfflinePrecache(): Plugin {
  return {
    name: 'the-verge-offline-precache',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? 'dist';
      const swPath = join(outDir, 'sw.js');
      const sourceSwPath = 'public/sw.js';
      const urls = Array.from(new Set([
        '/',
        ...walkFiles(outDir)
          .filter((file) => !file.endsWith('/sw.js'))
          .filter((file) => /\.(?:js|css|html|webmanifest|svg|png|jpg|jpeg|webp|ico|woff|woff2)$/i.test(file))
          .map((file) => '/' + relative(outDir, file).replace(/\\/g, '/')),
      ])).sort();

      mkdirSync(outDir, { recursive: true });
      const template = readFileSync(sourceSwPath, 'utf8');
      const marker = 'const PRECACHE_URLS = [];';
      if (!template.includes(marker)) {
        throw new Error('Service worker precache marker is missing.');
      }
      const built = template.replace(marker, 'const PRECACHE_URLS = ' + JSON.stringify(urls) + ';');
      writeFileSync(swPath, built, 'utf8');
    },
  };
}

export default defineConfig({
  plugins: [react(), generateOfflinePrecache()],
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
  },
  server: { host: '0.0.0.0', port: 5173 },
});
