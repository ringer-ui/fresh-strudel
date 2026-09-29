// Turning a MIDI knob edits "the number you have selected" in the code.
// Pure logic (no browser needed): find the number at the cursor, and turn knob movements into new values for it.
import { CONTROLS, maskComments, formatNumber, toPos, fromPos } from './visual.js';

const NUM_TOKEN = /(?<![\w.])-?(?:\d+\.?\d*|\.\d+)(?![\w.])/g;      // -3, 0.5, .5, 120 (not part of a word like bd2 or 1.2.3)

// Is `pos` inside a string literal? (comments ignored)
export function inString(code, pos) {
  let quote = null;
  const m = maskComments(code);
  for (let i = 0; i < pos && i < m.length; i++) {
    const c = m[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; }
    else if (c === '"' || c === "'" || c === '`') quote = c;
  }
  return !!quote;
}

// A sensible slider range for a number we know nothing about.
export function genericSpec(value, inMini) {
  if (inMini) return { lo: Math.min(value, 0) - 12, hi: Math.max(value, 0) + 12, step: 1 };          // note strings: scale degrees, indexes
  if (value >= 0 && value <= 1) return { lo: 0, hi: 1, step: 0.01 };
  if (Number.isInteger(value)) return { lo: Math.min(0, value * 2), hi: Math.max(8, value * 2), step: 1 };
  return { lo: Math.min(0, value * 2), hi: Math.max(1, value * 2), step: 0.01 };
}

// The number the cursor (or selection) is on: { from, to, value, name, spec, mini } or null.
export function numberAt(code, selFrom, selTo = selFrom) {
  const m = maskComments(code);
  const lineFrom = m.lastIndexOf('\n', selFrom - 1) + 1;
  let lineTo = m.indexOf('\n', selFrom); if (lineTo < 0) lineTo = m.length;
  const line = m.slice(lineFrom, lineTo);
  let best = null;
  for (const t of line.matchAll(NUM_TOKEN)) {
    const from = lineFrom + t.index, to = from + t[0].length;
    if (selTo > selFrom ? (selFrom <= from && selTo >= to) || (from <= selFrom && selTo <= to) : (selFrom >= from && selFrom <= to)) {
      // a cursor between two numbers ("3|4") prefers the one it is inside; touching only an end is fine
      if (!best || (selFrom > from && selFrom < to)) best = { from, to, text: t[0] };
    }
  }
  if (!best) return null;
  const before = m.slice(lineFrom, best.from);
  const name = (/([A-Za-z_$][\w$]*)\s*:\s*$/.exec(before) ?? /\.([A-Za-z_$][\w$]*)\(\s*$/.exec(before) ?? /([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before))?.[1] ?? null;
  const mini = inString(code, best.from);
  const value = Number(best.text);
  const spec = (!mini && name && CONTROLS[name]) || genericSpec(value, mini);
  return { from: best.from, to: best.to, value, name: mini ? null : name, spec, mini };
}

// Knob movement -> new values. `mode`: 'absolute' (a knob sends its position 0..127) or 'relative' (an encoder sends +/- ticks,
// as offset-binary: 65 = +1, 63 = -1). Either way the value moves from where it is: nothing jumps when you pick a new target.
export function createKnob({ mode = 'absolute', sensitivity = 1 } = {}) {
  let id = null, pos = 0, last = null;
  return {
    setMode(m) { mode = m; last = null; },
    // target: from numberAt(); returns the new text for the number, or null if nothing should change
    turn(cc, target) {
      if (!target) return null;
      if (target.from !== id) { id = target.from; pos = toPos(target.spec, target.value); last = null; }   // new target: start from its current value
      let delta;
      if (mode === 'relative') delta = ((cc - 64) / 100) * sensitivity;
      else { if (last == null) { last = cc; return null; } delta = ((cc - last) / 127) * sensitivity; last = cc; }
      if (!delta) return null;
      pos = Math.min(1, Math.max(0, pos + delta));
      return formatNumber(fromPos(target.spec, pos), target.spec.step);
    },
    // after we rewrote the number, the target's length may have changed: keep following the same one
    follow(from) { id = from; },
    reset() { id = null; last = null; },
  };
}

// Every number in the code outside strings and comments (the parameters you would tweak), in order. Used by "next number".
export function numberSpots(code) {
  const m = maskComments(code), spots = [];
  for (const t of m.matchAll(NUM_TOKEN)) if (!inString(code, t.index)) spots.push({ from: t.index, to: t.index + t[0].length });
  return spots;
}
// The spot after (dir = 1) or before (dir = -1) the selection, wrapping around; null if there are none.
export function stepSpot(spots, selFrom, selTo, dir = 1) {
  if (!spots.length) return null;
  if (dir > 0) return spots.find((s) => s.from >= selTo && !(s.from === selFrom && s.to === selTo)) ?? spots[0];
  const before = spots.filter((s) => s.to <= selFrom && !(s.from === selFrom && s.to === selTo));
  return before.at(-1) ?? spots.at(-1);
}
