#!/usr/bin/env node
// Bundles the browser app with Vite. One source tree, two builds:
//   local  (node scripts/build-app.mjs)            -> app-dist/  everything, served by server.mjs
//   public (called by build-public.mjs)            -> the fenced local-only parts are stripped from the source BEFORE bundling,
//                                                     so nothing local-only can reach the bundle (not even as dead code)
// Vite only runs here, at build time. It is never resident while the app is in use, which keeps the local app light.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import preact from '@preact/preset-vite';
import { stripLocal } from './strip-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The browser source. Files that may contain fenced local-only parts (see strip-local.mjs) are listed in FENCED.
const SOURCE = ['index.html', 'style.css', 'app.js', 'chat.js', 'chat-direct.js', 'chat-prompt.mjs', 'friendly.js', 'preprocess.js', 'examples.js', 'snippets.js'];
const SOURCE_DIRS = ['src'];                                    // component code (Preact); copied whole if present
let LOCAL_ONLY = [];
const FENCED = new Set(['index.html', 'app.js', 'chat.js', 'style.css']);
const FENCED_EXT = /\.(jsx?|tsx?|css|html)$/;
// Runtime files loaded by URL, not bundled (the Strudel engine is a prebuilt IIFE; soundfonts is loaded lazily against an import map).
const VENDOR = ['strudel-web.js', 'soundfonts.mjs', 'shim-core.mjs', 'shim-webaudio.mjs', 'LICENSE-strudel', 'LICENSE-soundfonts', 'assets/clockworker-ZDiUtESR.js'];

const copyTree = (from, to, transform) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyTree(a, b, transform); } else fs.writeFileSync(b, transform(e.name, fs.readFileSync(a)));
  }
};

export async function buildApp({ mode, out }) {
  if (!['local', 'public'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  const stage = fs.mkdtempSync(path.join(root, '.build', `${mode}-`));   // inside the project so bare imports (preact, codemirror) resolve; unique so parallel builds can't collide
  const strip = mode === 'public';
  const put = (rel) => {
    const from = path.join(root, rel);
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    const text = fs.readFileSync(from);
    fs.writeFileSync(path.join(stage, rel), strip && FENCED.has(rel) ? stripLocal(text.toString('utf8')) : text);
  };
  for (const f of SOURCE) put(f);
  if (mode === 'local') for (const f of LOCAL_ONLY) put(f);
  for (const d of SOURCE_DIRS) if (fs.existsSync(path.join(root, d))) {
    fs.mkdirSync(path.join(stage, d), { recursive: true });
    copyTree(path.join(root, d), path.join(stage, d), (name, buf) => (strip && FENCED_EXT.test(name) ? Buffer.from(stripLocal(buf.toString('utf8'))) : buf));
  }

  fs.rmSync(out, { recursive: true, force: true });
  await build({
    root: stage, configFile: false, base: './', publicDir: false, logLevel: 'warn',
    plugins: [preact()],
    build: {
      outDir: out, emptyOutDir: true, target: 'es2022', modulePreload: { polyfill: false }, cssCodeSplit: false, sourcemap: false,
      rollupOptions: { output: {
        entryFileNames: 'app.js', chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (a) => ((a.names?.[0] ?? a.name ?? '').endsWith('.css') ? 'style.css' : 'assets/[name]-[hash][extname]'),
      } },
    },
  });
  for (const f of VENDOR) {
    const from = path.join(root, 'vendor', f);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(out, 'vendor', f)), { recursive: true });
    fs.copyFileSync(from, path.join(out, 'vendor', f));
  }
  fs.rmSync(stage, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.env.STRUDEL_EASY_APP_OUT ?? path.join(root, 'app-dist'));
  await buildApp({ mode: 'local', out });
  console.log(`app built -> ${path.relative(root, out) || out}`);
}
