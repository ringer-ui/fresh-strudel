import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Build into a temp folder: the real dist/ (what gets deployed) must never be overwritten by a test.
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'strudel-easy-dist-'));
execFileSync('node', ['scripts/build-public.mjs'], { cwd: root, stdio: 'pipe', env: { ...process.env, STRUDEL_EASY_OUT: dist, STRUDEL_EASY_SOURCE_URL: 'https://example.com/src' } });
const files = () => fs.readdirSync(dist, { recursive: true }).filter((f) => fs.statSync(path.join(dist, f)).isFile()).map(String);

test('public build contains only the allowlisted app files: no server, songs, tools, docs or tests', () => {
  const names = files();
  for (const banned of ['server.mjs', 'package.json', 'songs', 'tools', 'docs', 'test', 'node_modules', 'scripts', 'README.md']) {
    assert.ok(!names.some((n) => n === banned || n.startsWith(banned + path.sep)), `${banned} must not be published`);
  }
  for (const needed of ['index.html', 'app.js', 'style.css', 'config.js', 'licenses.html', '_headers', 'vendor/strudel-web.js']) assert.ok(names.includes(needed), needed);
});

test('nothing from this computer is in the build', () => {
  for (const f of files()) {
    const text = fs.readFileSync(path.join(dist, f), 'utf8');
    assert.ok(!/\/Users\/|\/Volumes\/|\.ts\.net|sk-ant-[A-Za-z0-9_-]{20,}/.test(text), `${f} leaks a local path, host or key`);
  }
});

test('local-only features are not in the build at all', () => {
  // Built from pieces so this test file itself never contains the words it looks for (the public source is scanned for them).
  const words = ['plain' + 'jane', 'pj' + 'Api', '\\/p' + 'j\\/', 'pj' + '-toggle', 'id="p' + 'j"', 'pj' + '_[a-z]', '@local' + '-', 'cor' + 'pus', 'search' + '_examples', 'chat' + '-library'];
  const bad = new RegExp(words.join('|'), 'i');
  for (const f of files()) assert.ok(!bad.test(fs.readFileSync(path.join(dist, f), 'utf8')), `${f} mentions a local-only feature`);
  assert.ok(!files().some((f) => new RegExp('plain' + 'jane|chat-prompt-' + 'pj').test(f)));
});

test('config marks the build public and CSP is strict', () => {
  assert.match(fs.readFileSync(path.join(dist, 'config.js'), 'utf8'), /"public":true/);
  const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
  assert.match(headers, /default-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-inline'? https|script-src[^;]*unsafe-inline/.test(headers), 'no unsafe-inline scripts');
  const connect = headers.match(/connect-src ([^;]+)/)[1].split(' ');
  assert.deepEqual(connect.filter((h) => h.startsWith('http')).sort(), ['https://api.anthropic.com', 'https://esm.sh', 'https://felixroos.github.io', 'https://raw.githubusercontent.com']);
  assert.ok(!/localhost|127\.0\.0\.1/.test(headers));
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.ok(!html.includes('frame-ancestors'));
});

test('the import map hash in the CSP matches the page', async () => {
  const { createHash } = await import('node:crypto');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const body = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  assert.ok(html.includes(`sha256-${createHash('sha256').update(body).digest('base64')}`));
});

test('licenses page links the configured source', () => {
  assert.match(fs.readFileSync(path.join(dist, 'licenses.html'), 'utf8'), /https:\/\/example\.com\/src/);
});

test('every script and stylesheet the page loads is in the build, and the import map still matches the CSP hash', async () => {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  for (const [, ref] of html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"#:]+)"/g)) assert.ok(fs.existsSync(path.join(dist, ref)), `${ref} is referenced but missing`);
  const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
  for (const [, chunk] of app.matchAll(/["'`]\.\/(chunks\/[\w.-]+\.js)["'`]/g)) assert.ok(fs.existsSync(path.join(dist, chunk)), `${chunk} missing`);
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(map, 'import map missing');
  const { createHash } = await import('node:crypto');
  assert.ok(html.includes(`'sha256-${createHash('sha256').update(map[1]).digest('base64')}'`), 'CSP hash does not match the import map');
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'the import map must come before the module script');
});

test('collected third-party code and corpus databases can never be published', async () => {
  const { BANNED_PATH } = await import('../scripts/banned.mjs');
  for (const p of ['strudelstore/README.md', 'strudelstore/licensed/x/a.strudel', 'corpus.licensed.db', 'corpus.all.db', 'x/corpus.db-wal', 'data.sqlite', 'a/b/c.db']) assert.ok(BANNED_PATH.test(p), `${p} must be banned`);
  for (const p of ['src/editor.js', 'index.html', 'vendor/strudel-web.js', 'docs/ROADMAP.md']) assert.ok(!BANNED_PATH.test(p), `${p} must be allowed`);
  for (const f of files()) {
    assert.ok(!BANNED_PATH.test(f), `${f} is in the public build`);
    assert.ok(!/strudelstore/.test(fs.readFileSync(path.join(dist, f), 'utf8')), `${f} mentions the collected store`);
  }
  // the source export (only present in the private repo): run it into a temp folder and look at what came out
  if (!fs.existsSync(path.join(root, 'scripts/export-public-source.mjs'))) return;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'strudel-easy-export-'));
  execFileSync('node', ['scripts/export-public-source.mjs', out], { cwd: root, stdio: 'pipe' });
  const exported = fs.readdirSync(out, { recursive: true }).map(String).filter((f) => !/^node_modules/.test(f));
  assert.ok(exported.length > 20 && !exported.some((f) => BANNED_PATH.test(f)), 'the export contains a banned path');
  assert.match(fs.readFileSync(path.join(out, '.gitignore'), 'utf8'), /strudelstore\/[\s\S]*\*\.db/);
});
