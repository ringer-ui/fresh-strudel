import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const build = (args) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strudel-easy-protect-'));
  execFileSync('node', ['scripts/build-public.mjs', ...args], { cwd: root, stdio: 'pipe', env: { ...process.env, STRUDEL_EASY_OUT: dir } });
  return dir;
};

test('without --protect there is no worker, so the site stays open', () => {
  assert.ok(!fs.existsSync(path.join(build([]), '_worker.js')));
});

const dir = build(['--protect']);
const src = fs.readFileSync(path.join(dir, '_worker.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
const assets = { fetch: async () => new Response('<html>the app</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) };
const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const req = (auth) => new Request('https://example.test/', auth ? { headers: { Authorization: auth } } : {});

test('the password is never written into the build', () => {
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, String(f));
    if (fs.statSync(p).isFile()) assert.ok(!/SITE_PASSWORD\s*=|password\s*[:=]\s*['"][^'"]{3,}/i.test(fs.readFileSync(p, 'utf8')), f);
  }
});

test('fails closed: with no password configured every request is refused', async () => {
  for (const auth of [undefined, basic('x', ''), basic('x', 'anything')]) {
    const r = await worker.fetch(req(auth), { ASSETS: assets });
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes('the app'));
  }
});

test('no password, wrong password and garbage are refused with a login prompt', async () => {
  const env = { SITE_PASSWORD: 'correct horse', ASSETS: assets };
  for (const auth of [undefined, basic('me', 'wrong'), basic('me', 'correct hors'), basic('me', 'correct horse!'), 'Basic !!!notbase64', 'Bearer abc', 'Basic ']) {
    const r = await worker.fetch(req(auth), env);
    assert.equal(r.status, 401, String(auth));
    assert.match(r.headers.get('WWW-Authenticate'), /^Basic realm=/);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.ok(!(await r.text()).includes('the app'));
  }
});

test('the right password (any username; colons and unicode allowed in the password) serves the site with security headers', async () => {
  for (const [user, pass] of [['anyone', 'correct horse'], ['', 'correct horse']]) {
    const r = await worker.fetch(req(basic(user, pass)), { SITE_PASSWORD: 'correct horse', ASSETS: assets });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '<html>the app</html>');
    assert.match(r.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.equal(r.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  }
  const u = await worker.fetch(req(basic('me', 'pässwörd:ünï')), { SITE_PASSWORD: 'pässwörd:ünï', ASSETS: assets });
  assert.equal(u.status, 200);
});

test('a refused request never reaches the assets', async () => {
  let touched = 0;
  const spy = { fetch: async () => { touched++; return new Response('x'); } };
  await worker.fetch(req(basic('me', 'nope')), { SITE_PASSWORD: 'yes', ASSETS: spy });
  await worker.fetch(req(), { ASSETS: spy });
  assert.equal(touched, 0);
});
