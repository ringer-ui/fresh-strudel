import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, lineDiff, unifiedDiff, changedTracks, describeChange, hashOf, ago } from '../src/session.js';

const A = 'tempo(100)\ndrums({ kick: "x...x..." })\nbass("0 3 5 3")\n';
const B = 'tempo(100)\ndrums({ kick: "x...x.x." })\nbass("0 3 5 3")\nlead("c4 e4")\n';
const clock = (t = 1_000_000) => { const c = () => t; c.tick = (ms) => { t += ms; }; return c; };

test('line diff and the compact unified view', () => {
  assert.deepEqual(lineDiff('a\nb', 'a\nc').map((l) => l.op + l.text), [' a', '-b', '+c']);
  assert.equal(unifiedDiff(A, B, { context: 0 }), '- drums({ kick: "x...x..." })\n+ drums({ kick: "x...x.x." })\n  …\n+ lead("c4 e4")');
  assert.equal(unifiedDiff(A, A), '');
});

test('which tracks changed, in words', () => {
  assert.deepEqual(changedTracks(A, B), { added: ['lead'], removed: [], changed: ['drums'], other: false });
  assert.equal(describeChange(A, B), 'changed drums; added lead');
  assert.equal(describeChange(A, A), 'no change');
  assert.match(describeChange(A, A.replace('tempo(100)', 'tempo(90)')), /outside the tracks/);
  assert.match(describeChange('bass("0")', 'bass("0") // hi'), /changed bass/);
});

test('snapshots skip duplicates, name themselves, and are capped', () => {
  const now = clock(), s = createSession({ now });
  const v1 = s.snapshot({ code: A, source: 'typing' });
  assert.equal(s.snapshot({ code: A }).id, v1.id); assert.equal(s.versions.length, 1);
  now.tick(1000); s.snapshot({ code: B, source: 'claude', label: 'added a lead' });
  assert.equal(s.versions.length, 2); assert.equal(s.lastClaudeId, 2);
  assert.equal(s.snapshot({ code: B, label: 'later label' }).label, 'added a lead');       // an existing label isn't overwritten
  for (let i = 0; i < 80; i++) s.snapshot({ code: `bass("${i}")`, force: true });
  assert.ok(s.versions.length <= 60);
});

test('edits in a burst coalesce into one activity line', () => {
  const now = clock(), s = createSession({ now });
  for (let i = 0; i < 5; i++) { s.record('edit', 'you typed', { source: 'typing' }); now.tick(300); }
  assert.equal(s.events.length, 1); assert.equal(s.events[0].count, 5);
  now.tick(10_000); s.record('edit', 'you typed', { source: 'typing' }); assert.equal(s.events.length, 2);
  s.record('edit', 'you used the visual editor', { source: 'visual' }); assert.equal(s.events.length, 3);
});

test('the digest tells Claude what the user did since its last change, and what was tried', () => {
  const now = clock(), s = createSession({ now });
  s.snapshot({ code: A, source: 'typing' });
  now.tick(60_000); s.snapshot({ code: B, source: 'claude', label: 'made the kick busier and added a lead' });
  s.record('chat', 'you asked: "busier kick"'); now.tick(120_000);
  const mine = B.replace('c4 e4', 'c4 e4 g4');
  s.record('edit', 'you typed', { source: 'typing' });
  s.noteLibrary([{ id: 7, title: 'Dark techno bass', author: 'Ann', license: 'CC0' }]);
  const d = s.digest({ code: mine, playing: true, playingSince: now() - 90_000, error: 'oops\nmore', selection: 'the number filter = 400' });
  assert.match(d, /now: playing for 2m/);          // 90 s rounds to 2m
  assert.match(d, /unresolved error: oops$/m);
  assert.match(d, /since your last change to the song \(2m ago\), the user did: changed lead/);
  assert.match(d, /keep them, build on them/);
  assert.match(d, /you asked: "busier kick"/);
  assert.match(d, /library examples already used this session: "Dark techno bass" by Ann/);
  assert.match(d, /the user has selected: the number filter = 400/);
  assert.match(d, /how the song changed recently:[\s\S]*v2 \(Claude: made the kick busier/);
  assert.ok(d.length <= 3600);
  const untouched = s.digest({ code: B });
  assert.match(untouched, /nothing \(the song is exactly as you left it\)/);
  assert.match(createSession({ now }).digest({ code: A }), /you have not changed this song yet/);
});

test('digest stays within its size limit however long the history is', () => {
  const now = clock(), s = createSession({ now });
  for (let i = 0; i < 40; i++) { s.snapshot({ code: `bass("${i} 3 5 ${i}")\n`.repeat(30), source: 'typing', force: true }); s.record('edit', `edit number ${i} with a fairly long description of it`, { source: 'x' + i }); now.tick(1000); }
  const d = s.digest({ code: 'bass("1")', maxChars: 1500 });
  assert.ok(d.length <= 1500); assert.match(d, /^scene: /);
});

test('scenes are named, replace by name, and survive a reload; history is stored and capped by size', () => {
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const s = createSession({ storage, now: clock() });
  s.saveScene({ code: A, name: 'intro' }); s.saveScene({ code: B, name: 'intro' }); s.saveScene({ code: B, name: 'drop' });
  assert.deepEqual(s.scenes.map((x) => x.name), ['intro', 'drop']); assert.equal(s.scenes[0].code, B);
  s.snapshot({ code: A });
  return new Promise((r) => setTimeout(r, 900)).then(() => {
    const again = createSession({ storage, now: clock() });
    assert.deepEqual(again.scenes.map((x) => x.name), ['intro', 'drop']); assert.equal(again.versions.length, 1);
    assert.equal(createSession({ storage: { getItem() { throw new Error('blocked'); } } }).versions.length, 0);   // storage blocked: still works
  });
});

test('small helpers', () => {
  assert.equal(ago(5000), '5s'); assert.equal(ago(180_000), '3m'); assert.equal(ago(7_300_000), '2h');
  assert.notEqual(hashOf('a'), hashOf('b'));
});
