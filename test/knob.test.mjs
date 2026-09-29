import test from 'node:test';
import assert from 'node:assert/strict';
import { numberAt, createKnob, inString, genericSpec } from '../src/knob.js';

const at = (code, marker = '|') => { const i = code.indexOf(marker); return numberAt(code.replace(marker, ''), i); };

test('finds the number at the cursor, with its name and range', () => {
  const t = at('bass("0 3", { vol: .5, filter: 4|00 })');
  assert.deepEqual([t.value, t.name, t.mini, t.spec.log], [400, 'filter', false, true]);
  const m = at('.lpf(12|00).room(0.3)'); assert.deepEqual([m.value, m.name], [1200, 'lpf']);
  assert.equal(at('.room(0.3|)').value, 0.3);           // cursor at the end of the number still counts
});

test('numbers inside note strings step in whole numbers; plain variables get a generic range', () => {
  const s = at('bass("0 |3 5")'); assert.deepEqual([s.value, s.mini, s.name, s.spec.step], [3, true, null, 1]);
  const v = at('const cutoff = 4|00'); assert.deepEqual([v.value, v.name], [400, 'cutoff']);
  assert.deepEqual(genericSpec(0.4, false), { lo: 0, hi: 1, step: 0.01 });
  assert.deepEqual(genericSpec(120, false), { lo: 0, hi: 240, step: 1 });
  assert.equal(at('note("c|3 e3")'), null);              // c3 is a note name, not a number
  assert.equal(at('drums("bd2| hh")'), null);            // digits glued to a word are part of the word
  assert.equal(at('// .lpf(4|00)'), null);               // comments don't count
});

test('negative numbers keep their sign; selections work', () => {
  assert.equal(at('bass("0 -|2")').value, -2);
  const code = 'x.gain(0.8).lpf(300)';
  assert.equal(numberAt(code, 7, 10).value, 0.8);
  assert.equal(numberAt(code, 0, 3), null);
});

test('inString ignores quotes in comments', () => {
  assert.equal(inString('a("x1")', 5), true); assert.equal(inString("// it's\nfoo(1)", 13), false);
});

test('absolute knob: first message only anchors, then moves relative to the current value', () => {
  const k = createKnob(); const target = { from: 5, value: 0.5, spec: { lo: 0, hi: 1, step: 0.01 } };
  assert.equal(k.turn(64, target), null);                        // anchor: no jump
  assert.equal(k.turn(127, target), '1');                        // +63/127 of the range from 0.5, clamped at the top
  assert.equal(k.turn(0, target), '0');                          // the whole way back down: -127/127 of the range
});

test('relative encoder: offset-binary ticks', () => {
  const k = createKnob({ mode: 'relative' }); const target = { from: 1, value: 0.5, spec: { lo: 0, hi: 1, step: 0.01 } };
  assert.equal(k.turn(65, target), '0.51'); assert.equal(k.turn(63, target), '0.5'); assert.equal(k.turn(64, target), null);
});

test('a new target starts from its own value (no jump)', () => {
  const k = createKnob({ mode: 'relative' });
  k.turn(65, { from: 1, value: 0.2, spec: { lo: 0, hi: 1, step: 0.01 } });
  assert.equal(k.turn(65, { from: 20, value: 0.9, spec: { lo: 0, hi: 1, step: 0.01 } }), '0.91');
});
