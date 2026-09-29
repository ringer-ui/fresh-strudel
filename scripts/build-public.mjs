#!/usr/bin/env node
// Builds dist/: the public, static version of Strudel Easy.
//   node scripts/build-public.mjs                 (STRUDEL_EASY_SOURCE_URL=https://… links the source in the footer)
//   node scripts/build-public.mjs --protect       also adds _worker.js: the whole site then asks for a password (Cloudflare Pages)
// What's in it: the app, the vendored Strudel engine and soundfonts, and nothing else. No server, no /api, no songs/,
// no tools/, nothing that only makes sense on one machine. Chat runs in the visitor's browser with their own API key.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from './build-app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.env.STRUDEL_EASY_OUT ?? path.join(root, 'dist'));   // tests build elsewhere, so they never touch dist/
const sourceUrl = process.env.STRUDEL_EASY_SOURCE_URL ?? '';
const protect = process.argv.includes('--protect');

// The app is bundled by scripts/build-app.mjs from an explicit allowlist of source files, with the fenced local-only parts
// stripped from the source before bundling. Anything not named there can't end up on the internet by accident.
await buildApp({ mode: 'public', out });

fs.writeFileSync(path.join(out, 'config.js'), `window.STRUDEL_EASY = ${JSON.stringify({ public: true, sourceUrl })};\n`);

// index.html: config first, strict CSP, footer.
let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const importmap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!importmap) throw new Error('import map not found in index.html');
const importmapHash = crypto.createHash('sha256').update(importmap[1]).digest('base64');

const cspDirectives = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-eval' 'sha256-${importmapHash}' https://esm.sh blob:`,   // unsafe-eval: Strudel runs the song as JavaScript
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://api.anthropic.com https://raw.githubusercontent.com https://felixroos.github.io https://esm.sh data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'",
];
const CSP = cspDirectives.join('; ');
const CSP_HEADER = CSP + "; frame-ancestors 'none'";   // frame-ancestors only works as a real header, not in <meta>

if (!html.includes('<meta charset="utf-8">')) throw new Error('charset meta not found in index.html');
html = html.replace('<meta charset="utf-8">',
  `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <meta name="referrer" content="no-referrer">\n  <script src="config.js"></script>`);
html = html.replace('</body>', `  <footer class="site-footer">Strudel Easy · built on <a href="https://strudel.cc" rel="noopener">Strudel</a> · <a href="licenses.html">Licenses &amp; source</a></footer>\n</body>`);
fs.writeFileSync(path.join(out, 'index.html'), html);

fs.writeFileSync(path.join(out, 'licenses.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Licenses and source</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#1d2026;background:#f6f6f3}@media(prefers-color-scheme:dark){body{color:#e6e8ec;background:#14161a}a{color:#ff9a80}}</style></head>
<body><h1>Licenses and source</h1>
<p>Strudel Easy is a front end for <a href="https://strudel.cc" rel="noopener">Strudel</a>. It bundles Strudel's web build (<code>@strudel/web</code>) and General-MIDI soundfont support (<code>@strudel/soundfonts</code>), both licensed <strong>AGPL-3.0-or-later</strong>. Because this site serves them to you, the corresponding source is available:</p>
<ul>
<li>Strudel source: <a href="https://codeberg.org/uzu/strudel" rel="noopener">codeberg.org/uzu/strudel</a></li>
<li>${sourceUrl ? `Strudel Easy source: <a href="${sourceUrl}" rel="noopener">${sourceUrl}</a>` : 'Strudel Easy source: <em>(not configured for this deployment)</em>'}</li>
<li>Licence texts: <a href="vendor/LICENSE-strudel">Strudel</a>, <a href="vendor/LICENSE-soundfonts">soundfonts</a></li>
</ul>
<p>Sounds load from third-party sample packs on GitHub (Dirt-Samples, the Tidal drum machines, dough-samples) and General-MIDI soundfonts from felixroos.github.io. Their licences are their own.</p>
<p>Privacy: this site has no server and no analytics. Your songs stay in your browser (local storage). Chat is optional: it uses your own Anthropic API key, kept in your browser and sent only to api.anthropic.com, plus your current song and messages.</p>
<p><a href="./">Back to the app</a></p></body></html>
`);

fs.writeFileSync(path.join(out, '_headers'), `/*
  Content-Security-Policy: ${CSP_HEADER}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY
`);

const HEADERS_TEXT_LINES = () => fs.readFileSync(path.join(out, '_headers'), 'utf8').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);

// --protect: a Cloudflare Pages "advanced mode" worker that checks a password before serving anything.
// The password is NOT in this file: it is the secret SITE_PASSWORD set in the Cloudflare dashboard. If it isn't set the
// site refuses everyone (fails closed). Browsers show their own login box; the username is ignored.
if (protect) {
  const headerObject = Object.fromEntries(HEADERS_TEXT_LINES().map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
  fs.writeFileSync(path.join(out, '_worker.js'), `// Generated by scripts/build-public.mjs --protect. Password = the Cloudflare secret SITE_PASSWORD.
const SECURITY_HEADERS = ${JSON.stringify(headerObject, null, 2)};

const enc = new TextEncoder();
// Compare digests so timing doesn't reveal how much of a guess was right.
async function sameSecret(a, b) {
  const [x, y] = (await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])).map((d) => new Uint8Array(d));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function passwordFrom(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Basic\\s+(.+)$/i);
  if (!m) return null;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
    return text.slice(text.indexOf(':') + 1);
  } catch { return null; }
}

function refuse(status, body, extra = {}) {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
}

export default {
  async fetch(request, env) {
    const secret = env.SITE_PASSWORD;
    if (!secret) return refuse(503, 'This site is locked and no password has been configured.');
    const given = passwordFrom(request);
    if (given === null || !(await sameSecret(given, secret))) {
      return refuse(401, 'Password required.', { 'WWW-Authenticate': 'Basic realm="Strudel Easy", charset="UTF-8"' });
    }
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    out.headers.set('Cache-Control', 'private, no-store');      // shared caches must not keep protected pages
    out.headers.set('Vary', 'Authorization');
    return out;
  },
};
`);
}

// Safety net: refuse to leave a build behind that contains anything from this computer.
const FORBIDDEN = [
  [/\/Users\/[A-Za-z0-9._-]+/, 'a local home-directory path'], [/\/Volumes\//, 'a local volume path'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'], [/\.ts\.net/, 'a private tailnet hostname'],
];
// Names you never want published (your username, domains...) go in the environment, not in this file:
//   STRUDEL_EASY_EXTRA_FORBIDDEN='name|example\.com' node scripts/build-public.mjs
if (process.env.STRUDEL_EASY_EXTRA_FORBIDDEN) FORBIDDEN.push([new RegExp(process.env.STRUDEL_EASY_EXTRA_FORBIDDEN, 'i'), 'a name from STRUDEL_EASY_EXTRA_FORBIDDEN']);
const problems = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const built = walk(out);
for (const f of built) {
  const text = fs.readFileSync(f, 'utf8');
  for (const [re, what] of FORBIDDEN) {
    const m = text.match(re);
    if (m) problems.push(`${path.relative(out, f)}: ${what} (${m[0].slice(0, 40)})`);
  }
}
if (problems.length) { console.error('Refusing to build:\n  ' + problems.join('\n  ')); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); }

const size = built.reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`dist/ ready: ${built.length} files, ${(size / 1024).toFixed(0)} KB`);
if (protect) console.log('Password protection ON: deploy, then set the secret SITE_PASSWORD in Cloudflare (see docs/PUBLIC_DEPLOY.md).');
if (!sourceUrl) console.warn('Note: STRUDEL_EASY_SOURCE_URL is not set, so licenses.html has no link to this app\'s own source. Set it before publishing (AGPL components are served).');
