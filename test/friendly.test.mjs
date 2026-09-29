import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { installFriendly, parseKey } from '../friendly.js';
import { SNIPPETS } from '../snippets.js';

await core.evalScope(core, mini, tonal);
core.setTime?.(() => 0);
let lastCps;
mini.miniAllStrings();
const f = installFriendly(globalThis, { setCps: (c) => { lastCps = c; } });
f.reset({ bpm: 120, key: 'C minor' });

// The browser's transpiler hands our functions mini-notation Patterns, not raw strings.
const m = (str) => mini.mini(str);
const haps = (p, cycles = 1) => p.queryArc(0, cycles).map((h) => h.value);

test('parseKey understands common spellings', () => {
  assert.deepEqual(parseKey('C minor'), { root: 'C', mode: 'minor' });
  assert.deepEqual(parseKey('f#m'), { root: 'F#', mode: 'minor' });
  assert.deepEqual(parseKey('Bb'), { root: 'Bb', mode: 'major' });
  assert.deepEqual(parseKey('D dorian'), { root: 'D', mode: 'dorian' });
  assert.deepEqual(parseKey('A minor pentatonic'), { root: 'A', mode: 'minor:pentatonic' });
  assert.throws(() => parseKey('nonsense'), /couldn't read/);
});

test('bass uses scale degrees in the current key with defaults', () => {
  const [v] = haps(bass('0 2'));
  assert.equal(v.note, 'C2');
  assert.equal(v.s, 'sawtooth');
  assert.equal(v.cutoff, 500);
  assert.equal(v.gain, 0.8);
  key('D minor');
  assert.equal(haps(bass('0'))[0].note, 'D2');
  f.reset({ key: 'C minor' });
});

test('note names skip the scale', () => {
  assert.equal(haps(bass('eb2 g2'))[0].note, 'eb2');
});

test('options: aliases, overrides, unknown keys forwarded, bad keys explained', () => {
  const v = haps(lead('0', { vol: 0.2, reverb: 0.9, sound: 'square', crush: 4, delay: 0.1 }))[0];
  assert.equal(v.gain, 0.2); assert.equal(v.room, 0.9); assert.equal(v.s, 'square'); assert.equal(v.crush, 4);
  assert.throws(() => lead('0', { banana: 1 }), /Unknown option "banana"/);
});

test('drums: friendly names, bank default, grid form', () => {
  f.reset({ bank: 'RolandTR808' });
  const v = haps(drums('kick snare'));
  assert.deepEqual(v.map((x) => x.s), ['bd', 'sd']);
  assert.equal(v[0].bank, 'RolandTR808');
  assert.equal(haps(drums('kick', { bank: 'LinnDrum' }))[0].bank, 'LinnDrum');
  const grid = core.stack(drums({ kick: 'x...X...', snare: '..o.' }));
  const out = grid.queryArc(0, 1).map((h) => h.value);
  assert.equal(out.filter((x) => x.s === 'bd').length, 2);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(out.find((x) => x.s === 'sd').gain, 0.35 * 0.9);   // ghost, scaled by default vol
  near(out.filter((x) => x.s === 'bd')[1].gain, 0.9);      // accent
  near(out.filter((x) => x.s === 'bd')[0].gain, 0.7 * 0.9);
  near(haps(drums({ kick: 'X' }, { vol: 0.5 }))[0].gain, 0.5);
  assert.throws(() => drums({ kick: 'x?x.' }), /isn't a step/);
  f.reset({});
});

test('chords are voiced and use pad/chord defaults', () => {
  const v = haps(chords('<Cm7 Fm7>'));
  assert.ok(Array.isArray(v) && v.length >= 4, 'voiced notes');
  assert.equal(v[0].s, 'sawtooth');
  assert.equal(haps(pad('C'))[0].attack, 0.5);
});

test('pattern shortcuts exist (and never shadow real Strudel methods) and map to strudel controls', () => {
  const v = haps(bass('0').vol(0.1).lpf(900).hipass(80).reverb(0.5))[0];
  assert.equal(v.gain, 0.1); assert.equal(v.cutoff, 900); assert.equal(v.hcutoff, 80); assert.equal(v.room, 0.5);
  assert.equal(haps(bass('0 1').bars(2)).length, 1);
  assert.ok(haps(bass('0').sweep(200, 4000, 4)).length === 1);
  assert.ok(haps(bass('0').humanize()).length === 1);
});

test('shortcuts do not replace built-in Strudel methods', () => {
  const P = core.Pattern.prototype;
  assert.ok(!P.filter.toString().includes('lpf'));
  assert.ok(!P.echo.toString().includes('delay'));
});

test('tempo(bpm) sets cycles per second assuming 4 beats per bar', () => {
  tempo(120);
  assert.equal(lastCps, 0.5);
  f.reset({ bpm: 60 });
  assert.equal(lastCps, 0.25);
  assert.throws(() => tempo(0), /beats per minute/);
  f.reset({});
});

test('works when strings arrive as mini-notation patterns (what the transpiler does)', () => {
  key(m('D dorian'));
  assert.equal(haps(bass(m('0 1')))[0].note, 'D2');
  key(m('A minor pentatonic'));
  assert.equal(haps(bass(m('0')))[0].note, 'A2');
  f.reset({ key: 'C minor' });
  assert.equal(haps(bass(m('eb2 g2')))[0].note, 'eb2');                    // note names detected
  assert.equal(haps(bass(m('<c2 [~ eb2]>')), 2).length, 2);
  const kit = haps(drums(m('kick snare:2 hat*2')), 1).map((v) => v.s + (v.n ? ':' + v.n : ''));
  assert.deepEqual(kit.slice(0, 2), ['bd', 'sd:2']);
  const rows = drums({ kick: m('x.......'), snare: m('....x...') }).queryArc(0, 1).map((h) => h.value.s);
  assert.deepEqual(rows.sort(), ['bd', 'sd']);
  assert.equal(haps(chords(m('<Cm7 Fm7>'), { sound: m('square') }))[0].s, 'square');
  assert.throws(() => key(m('zzz')), /key\("zzz"\)/);
});

test('a grid row that Strudel swallows gives a helpful error, not silence', () => {
  assert.throws(() => drums({ kick: m('x... ....') }), /no spaces/);
});

test('locked tempo/key (top bar touched last) ignore the code', () => {
  f.reset({ bpm: 160, key: 'G major', lock: { bpm: true, key: true } });
  tempo(90); key('D minor');
  assert.equal(lastCps, 160 / 240);
  assert.equal(haps(bass(m('0')))[0].note, 'G2');
  f.reset({});
  tempo(90);
  assert.equal(lastCps, 90 / 240);
});


test('every snippet is valid: parts evaluate, effects chain', () => {
  f.reset({});
  for (const [cat, items] of Object.entries(SNIPPETS)) {
    for (const [name, code] of Object.entries(items)) {
      const expr = cat === 'Effects' ? `bass("0 3")${code}` : code;
      // Mimic the transpiler: double-quoted strings become mini patterns.
      const src = expr.replace(/"([^"]*)"/g, (_, x) => `mini(${JSON.stringify(x)})`);
      const pat = new Function('mini', 'drums', 'bass', 'chords', 'pad', 'lead', 'n', 'return ' + src)(mini.mini, drums, bass, chords, pad, lead, core.n);
      assert.doesNotThrow(() => pat.queryArc(0, 4), `${cat}/${name}`);
      assert.ok(pat.queryArc(0, 4).length > 0, `${cat}/${name} makes sound`);
    }
  }
});

test('drum rows can span several bars (long string or one string per bar)', () => {
  f.reset({});
  const long = drums({ kick: 'x...............' + '....x...........' }).queryArc(0, 2);
  assert.equal(long.length, 2);                                   // two hits spread over two bars (two cycles)
  const perBar = drums({ kick: [m('x...............'), m('....x...........')] });
  const first = perBar.queryArc(0, 1).map((h) => h.whole.begin.valueOf());
  const second = perBar.queryArc(1, 2).map((h) => h.whole.begin.valueOf());
  assert.deepEqual(first, [0]);
  assert.deepEqual(second, [1.25]);                               // bar 2, step 4 of 16
});
