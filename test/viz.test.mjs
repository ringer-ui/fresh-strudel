import test from 'node:test';
import assert from 'node:assert/strict';
import { laneOf, pitchRange, drumNames, layoutRoll, spectrumBands, VIEW } from '../src/viz.js';

const toMidi = (n) => ({ c3: 48, e3: 52, g3: 55 }[n] ?? NaN);

test('events land on a pitch or a drum lane', () => {
  assert.deepEqual(laneOf({ note: 'e3', s: 'sawtooth' }, toMidi), { kind: 'note', midi: 52 });
  assert.deepEqual(laneOf({ note: 60 }, toMidi), { kind: 'note', midi: 60 });
  assert.equal(laneOf({ freq: 440 }, toMidi).midi, 69);
  assert.deepEqual(laneOf({ s: 'RolandTR909_bd:2' }, toMidi), { kind: 'drum', name: 'bd' });
  assert.deepEqual(laneOf({ note: 'zz', s: 'hh' }, toMidi), { kind: 'drum', name: 'hh' });     // unreadable note falls back to the sound
  assert.equal(laneOf('x', toMidi), null); assert.equal(laneOf({ gain: 1 }, toMidi), null);
});

test('pitch range gets padding and a minimum height', () => {
  const ev = (m) => ({ lane: { kind: 'note', midi: m } });
  assert.deepEqual(pitchRange([ev(50)]), { lo: 44, hi: 56 });
  assert.deepEqual(pitchRange([ev(40), ev(70)]), { lo: 38, hi: 72 });
  assert.equal(pitchRange([{ lane: { kind: 'drum', name: 'bd' } }]), null);
});

test('roll layout: playhead position, scrolling, drum lanes below the notes', () => {
  const span = VIEW.before + VIEW.after, w = 200, h = 100;
  const events = [
    { begin: 1, end: 1.5, lane: { kind: 'note', midi: 60 }, gain: 1 },
    { begin: 1.2, end: 1.3, lane: { kind: 'drum', name: 'bd' }, gain: 1 },
    { begin: 9, end: 10, lane: { kind: 'note', midi: 60 }, gain: 1 },           // far outside the window
  ];
  const { rects, playheadX, drums } = layoutRoll(events, 1.25, w, h, { drumH: 10 });
  assert.equal(playheadX, (VIEW.before / span) * w);
  assert.equal(rects.length, 2); assert.deepEqual(drums, ['bd']);
  assert.ok(rects.every((r) => r.active));                                       // both sound at cycle 1.25
  const drum = rects.find((r) => r.lane.kind === 'drum'), note = rects.find((r) => r.lane.kind === 'note');
  assert.ok(drum.y >= h - 10 && note.y + note.h <= h - 10);
  assert.deepEqual(layoutRoll(events, 5, w, h).rects, []);
});

test('spectrum bands are log-spaced, ordered and inside the FFT', () => {
  const b = spectrumBands(1024, 48000, 48);
  assert.equal(b.length, 48);
  assert.ok(b.every((x, i) => x.hi > x.lo && x.hi <= 1024 && (i === 0 || x.lo >= b[i - 1].lo)));
  assert.ok(b[47].hi - b[47].lo > b[0].hi - b[0].lo);                            // higher bands cover more bins
});
