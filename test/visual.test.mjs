import test from 'node:test';
import assert from 'node:assert/strict';
import { findDrumGrids, nextStep, withStep, addDrumRow, removeDrumRow, findNoteStrings, withPitch, withLength, rollRange, findControls, formatNumber, toPos, fromPos, CONTROLS, maskComments } from '../src/visual.js';

const apply = (code, e) => code.slice(0, e.from) + e.text + code.slice(e.to);

test('drum grid rows are found with exact ranges', () => {
  const code = 'drums({ kick: "x...x...", snare: "....x...", hat: ["x.x.", "x.x."] })';
  const [g] = findDrumGrids(code);
  assert.deepEqual(g.rows.map((r) => [r.name, r.editable]), [['kick', true], ['snare', true], ['hat', false]]);
  assert.equal(code.slice(g.rows[0].from, g.rows[0].to), 'x...x...');
  assert.equal(code.slice(g.rows[1].from, g.rows[1].to), '....x...');
});

test('editing a step changes only that character', () => {
  const code = '// beat\ndrums({\n  kick: "x...x...",\n  snare: "........",\n}, { vol: .8 })\nbass("0 3")';
  const [g] = findDrumGrids(code);
  const r = g.rows[1];
  const edited = code.slice(0, r.from) + withStep(r.text, 4, nextStep('.')) + code.slice(r.to);
  assert.equal(edited, code.replace('"........"', '"....x..."'));
  assert.equal(nextStep('x'), '.'); assert.equal(nextStep('x', { accent: true }), 'X'); assert.equal(nextStep('X', { accent: true }), 'o'); assert.equal(nextStep('o', { accent: true }), 'x');
});

test('commented-out grids are ignored, and "//" inside a string is not a comment', () => {
  assert.equal(findDrumGrids('// drums({ kick: "x..." })\n/* drums({ kick: "x..." }) */').length, 0);
  assert.equal(findDrumGrids('drums({ kick: "x..." }) // see http://x.y').length, 1);
  assert.equal(maskComments('a("//x") // y').trim(), 'a("//x")');
});

test('adding and removing rows keeps the layout', () => {
  let code = 'drums({\n  kick: "x...",\n  snare: "..x."\n})';
  let [g] = findDrumGrids(code);
  code = apply(code, addDrumRow(code, g, 'hat', 4));
  assert.equal(code, 'drums({\n  kick: "x...",\n  snare: "..x.",\n  hat: "...."\n})');
  [g] = findDrumGrids(code);
  assert.equal(apply(code, removeDrumRow(code, g, 1)), 'drums({\n  kick: "x...",\n  hat: "...."\n})');
  assert.equal(apply(code, removeDrumRow(code, g, 2)), 'drums({\n  kick: "x...",\n  snare: "..x."\n})');
  const one = 'drums({ kick: "x..." })'; const [g1] = findDrumGrids(one);
  assert.equal(apply(one, addDrumRow(one, g1, 'hat', 4)), 'drums({ kick: "x...", hat: "...." })');
  const none = 'drums({})'; const [g0] = findDrumGrids(none);
  assert.equal(apply(none, addDrumRow(none, g0, 'kick', 4)), 'drums({ kick: "...." })');
});

test('note strings: degrees and names, anything fancier is left as code', () => {
  const [a, b, c, d] = findNoteStrings('bass("0 ~ 3 ~")\nlead("c3 e3 ~ g3")\nbass("0 [3 5]*2")\nnote("c3 4")');
  assert.deepEqual([a.editable, a.kind, a.pitches], [true, 'degrees', [0, null, 3, null]]);
  assert.deepEqual([b.editable, b.kind, b.pitches], [true, 'names', [48, 52, null, 55]]);
  assert.equal(c.editable, false); assert.equal(d.editable, false);
  assert.equal(withPitch(a, 1, 5), '0 5 3 ~'); assert.equal(withPitch(a, 0, null), '~ ~ 3 ~');
  assert.equal(withPitch(b, 2, 60), 'c3 e3 c4 g3');
  assert.equal(withLength(a, 6), '0 ~ 3 ~ ~ ~'); assert.equal(withLength(a, 2), '0 ~');
  const r = rollRange(a); assert.ok(r.lo <= -2 && r.hi >= 9);
  assert.equal(findNoteStrings('bass("0 3")')[0].from, 'bass("'.length);
});

test('flats stay flats', () => {
  const [a] = findNoteStrings('note("eb3 g3")');
  assert.equal(withPitch(a, 1, 58), 'eb3 bb3');
});

test('knobs: options and method calls, exact number ranges', () => {
  const code = 'bass("0", { vol: .5, filter: 300 }).lpf(1200).room(0.3)\n// .gain(9)\nlead("1").gain( 0.8 , 2)';
  const cs = findControls(code);
  assert.deepEqual(cs.map((c) => [c.name, c.value, code.slice(c.from, c.to)]), [['vol', 0.5, '.5'], ['filter', 300, '300'], ['lpf', 1200, '1200'], ['room', 0.3, '0.3'], ['gain', 0.8, '0.8']]);
  assert.equal(findControls('x.lpf(sine.range(100,900))').length, 0);
  assert.equal(findControls('x.gain(0.5)')[0].how, 'method');
});

test('number formatting and slider maths round-trip', () => {
  assert.equal(formatNumber(0.5000001, 0.01), '0.5'); assert.equal(formatNumber(1234.6, 1), '1235'); assert.equal(formatNumber(0.125, 0.005), '0.125');
  const s = CONTROLS.lpf;
  assert.ok(Math.abs(fromPos(s, toPos(s, 400)) - 400) <= 1);
  assert.equal(toPos(CONTROLS.gain, 0), 0);
});
