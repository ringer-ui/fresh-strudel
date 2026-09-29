import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, findTracks, splitStatements } from '../preprocess.js';

const names = (code) => findTracks(code).map((t) => t.name);

test('bare instruments become labelled tracks, duplicates get numbers', () => {
  const { code } = prepare('tempo(90)\ndrums("kick ~")\nbass("0 3")\nbass("5 7")\n');
  assert.equal(code, 'tempo(90)\ndrums: drums("kick ~")\nbass: bass("0 3")\nbass2: bass("5 7")\n');
});

test('multi-line chains and comments stay in one statement', () => {
  const src = '// hi\nlead("0 2 4",\n  { vol: .5 })\n  .slow(2)\n  .echo(.3)\n/* x\ny */\nbass("0")';
  assert.equal(splitStatements(src).length, 2);
  assert.deepEqual(names(src), ['lead', 'bass']);
});

test('brackets inside strings do not break depth tracking', () => {
  const src = 'drums("bd [sd sd] <hh oh>")\nbass("0 ( ")\nlead("1")';
  assert.deepEqual(names(src), ['drums', 'bass', 'lead']);
});

test('user labels are kept, $ is numbered, mute adds underscore', () => {
  const src = 'kick: drums("bd*4")\n$: bass("0")\n$: lead("1")';
  assert.deepEqual(names(src), ['kick', 'track', 'track2']);
  const { code } = prepare(src, { muted: new Set(['kick', 'track2']) });
  assert.equal(code, '_kick: drums("bd*4")\ntrack: bass("0")\n_track2: lead("1")');
});

test('solo silences everything else', () => {
  const { code } = prepare('drums("bd")\nbass("0")\nlead("1")', { solo: new Set(['bass']) });
  assert.equal(code, '_drums: drums("bd")\nbass: bass("0")\n_lead: lead("1")');
});

test('non-track statements are untouched', () => {
  const src = 'const riff = "0 3 5"\nkey("D minor")\nbass(riff)';
  assert.equal(prepare(src).code, 'const riff = "0 3 5"\nkey("D minor")\nbass: bass(riff)');
});

test('line count never changes', () => {
  const src = 'drums("a")\n\nbass("b")\n  .slow(2)\n';
  assert.equal(prepare(src).code.split('\n').length, src.split('\n').length);
});

test('a label on its own line owns the next statement', () => {
  const src = '$drums:\nstack(\n  s("bd"),\n  s("hh")\n)\nbass("0")';
  assert.deepEqual(names(src), ['drums', 'bass']);
  const { code } = prepare(src, { muted: new Set(['drums']) });
  assert.equal(code, '_drums:\nstack(\n  s("bd"),\n  s("hh")\n)\nbass: bass("0")');
});

test('$name: labels are tracks and become plain names', () => {
  assert.deepEqual(names('$lead: note("c")\n$: note("e")'), ['lead', 'track']);
  assert.equal(prepare('$lead: note("c")').code, 'lead: note("c")');
});

test('trailing function declarations get a harmless silence so the transpiler accepts them', () => {
  const src = '$: arrange([1, f("bd")])\n\nfunction f(x) {\n  return s(x)\n}';
  assert.ok(prepare(src).code.endsWith('}\nsilence\n'));
  assert.equal(prepare('$: s("bd")').code, 'track: s("bd")');
  assert.equal(prepare('function f() {}').code, 'function f() {}');   // no tracks: leave it alone
});
