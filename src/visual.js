// Finds the parts of a song that have a visual editor (drum grids, simple note strings, numbers) and rewrites them in place.
// Everything works on the source text and returns exact character ranges, so an edit changes only that spot and never
// reformats the rest of your code. Anything it can't read exactly is reported as not editable and stays plain code.

// Same length as `code`, with comments blanked out (strings kept), so searches never match commented-out code.
export function maskComments(code) {
  let out = '', i = 0, quote = null;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += code[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      const end = code.indexOf('*/', i + 2), stop = end < 0 ? code.length : end + 2;
      while (i < stop) { out += code[i] === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c; i++;
  }
  return out;
}

// From index i (just after a value starts), the index where that value ends: the next top-level "," or the closing "}".
function endOfValue(m, i) {
  let depth = 0, quote = null;
  for (; i < m.length; i++) {
    const c = m[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '}') { if (depth === 0) return i; depth--; }
    else if (c === ',' && depth === 0) return i;
  }
  return m.length;
}

// ---- drum grids: drums({ kick: "x...x...", snare: "....x..." }) ----
export const STEP_CHARS = 'xXo.-';
export function findDrumGrids(code) {
  const m = maskComments(code), grids = [];
  for (const start of m.matchAll(/\bdrums\s*\(\s*\{/g)) {
    const open = start.index + start[0].length - 1;
    const rows = [];
    let i = open + 1, close = -1;
    for (;;) {
      while (i < m.length && /[\s,]/.test(m[i])) i++;
      if (i >= m.length) break;
      if (m[i] === '}') { close = i; break; }
      const key = /^([A-Za-z_$][\w$]*)\s*:\s*/.exec(m.slice(i));
      if (!key) break;                                                        // something we don't understand: stop, keep what we found
      const valueStart = i + key[0].length;
      const end = endOfValue(m, valueStart);
      const raw = m.slice(valueStart, end).trimEnd();
      const str = /^(["'`])([^"'`\\\n]*)\1$/.exec(raw);
      const row = { name: key[1], rowFrom: i, rowTo: valueStart + raw.length };
      if (str && /^[xXo.\-]+$/.test(str[2])) Object.assign(row, { editable: true, from: valueStart + 1, to: valueStart + 1 + str[2].length, text: str[2], quote: str[1] });
      else row.editable = false;                                              // an array of bars, a long string with spaces, a variable...
      rows.push(row);
      i = end;
    }
    if (close < 0) continue;
    grids.push({ from: start.index, open, close, rows });
  }
  return grids;
}

// A new text for a row after clicking step `i`. Click toggles a hit; `accent` cycles hit -> accent -> ghost.
export function nextStep(ch, { accent = false } = {}) {
  if (accent) return { x: 'X', X: 'o', o: 'x' }[ch] ?? 'x';
  return /[xXo]/.test(ch) ? '.' : 'x';
}
export function withStep(text, i, ch) { return text.slice(0, i) + ch + text.slice(i + 1); }

export const DRUM_ROW_NAMES = ['kick', 'snare', 'hat', 'openhat', 'clap', 'rim', 'tom', 'crash', 'ride', 'cowbell'];
export function addDrumRow(code, grid, name, steps = 16) {
  const row = `${name}: "${'.'.repeat(steps)}"`;
  const last = grid.rows.at(-1);
  if (!last) return { from: grid.open + 1, to: grid.open + 1, text: ` ${row} ` };
  const lineStart = code.lastIndexOf('\n', last.rowFrom) + 1;
  const multiline = code.slice(grid.open, grid.close).includes('\n');
  const indent = multiline ? /^\s*/.exec(code.slice(lineStart, last.rowFrom))[0] : '';
  return { from: last.rowTo, to: last.rowTo, text: multiline ? `,\n${indent}${row}` : `, ${row}` };
}
export function removeDrumRow(code, grid, index) {
  const row = grid.rows[index], next = grid.rows[index + 1];
  if (next) return { from: row.rowFrom, to: next.rowFrom, text: '' };                       // up to the start of the next row
  const prev = grid.rows[index - 1];
  return { from: prev ? prev.rowTo : row.rowFrom, to: row.rowTo, text: '' };                // the last row: also take the comma before it
}

// ---- simple note strings: bass("0 ~ 3 ~"), note("c3 e3 g3"), lead("4 ~ 2 ~") ----
const NOTE_FNS = 'bass|lead|note|n';
const NAME = /^([a-gA-G])([#b]?)(-?\d)$/;
export function parseToken(tok) {
  if (tok === '~' || tok === '-') return { rest: true };
  if (/^-?\d+$/.test(tok)) return { pitch: Number(tok), name: false };
  const m = NAME.exec(tok);
  if (m) return { pitch: midiOf(m), name: true, spell: m[2] === 'b' ? 'flat' : 'sharp' };
  return null;
}
const SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'], FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function midiOf(m) { return 12 * (Number(m[3]) + 1) + SEMI[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); }
export function noteName(midi, spell = 'sharp') { return (spell === 'flat' ? FLAT : SHARP)[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }

export function findNoteStrings(code) {
  const m = maskComments(code), found = [];
  for (const hit of m.matchAll(new RegExp(`\\b(${NOTE_FNS})\\s*\\(\\s*(["'\`])([^"'\`\\\\\\n]*)\\2`, 'g'))) {
    const text = hit[3], from = hit.index + hit[0].length - 1 - text.length, to = from + text.length;
    const words = text.trim().split(/\s+/).filter(Boolean);
    const toks = words.map(parseToken);
    if (!words.length || toks.some((t) => !t)) { found.push({ fn: hit[1], from, to, text, editable: false }); continue; }
    const pitched = toks.filter((t) => !t.rest);
    const named = pitched.length ? pitched.every((t) => t.name) : false, numeric = pitched.every((t) => !t.name);
    if (!named && !numeric) { found.push({ fn: hit[1], from, to, text, editable: false }); continue; }    // mixed names and numbers: leave it to the code
    found.push({ fn: hit[1], from, to, text, editable: true, words, kind: named ? 'names' : 'degrees', spell: pitched.find((t) => t.spell)?.spell ?? 'sharp',
      pitches: toks.map((t) => (t.rest ? null : t.pitch)) });
  }
  return found;
}
// The text for a note string after setting step i to `pitch` (null = rest). Same style as the string already uses.
export function withPitch(item, i, pitch) {
  const words = item.words.slice();
  words[i] = pitch == null ? '~' : item.kind === 'names' ? noteName(pitch, item.spell) : String(pitch);
  return words.join(' ');
}
export function withLength(item, n) {
  const words = item.words.slice(0, n);
  while (words.length < n) words.push('~');
  return words.join(' ');
}
// The pitches a piano roll should show for this string: its range, padded so there is room to add notes above and below.
export function rollRange(item) {
  const ps = item.pitches.filter((p) => p != null);
  const pad = item.kind === 'names' ? 5 : 3, min = ps.length ? Math.min(...ps) : (item.kind === 'names' ? 48 : 0), max = ps.length ? Math.max(...ps) : (item.kind === 'names' ? 60 : 7);
  return { lo: Math.min(min - pad, item.kind === 'names' ? 48 : -2), hi: Math.max(max + pad, item.kind === 'names' ? 72 : 9) };
}

// ---- knobs: numbers in options ({ vol: .5 }) and method calls (.lpf(400)) ----
// lo/hi/step: the slider; log: frequency-like values move in equal ratios
export const CONTROLS = {
  gain: { lo: 0, hi: 1.5, step: 0.01 }, vol: { lo: 0, hi: 1.5, step: 0.01 }, volume: { lo: 0, hi: 1.5, step: 0.01 },
  pan: { lo: 0, hi: 1, step: 0.01 },
  lpf: { lo: 40, hi: 16000, log: true, step: 1 }, filter: { lo: 40, hi: 16000, log: true, step: 1 }, cutoff: { lo: 40, hi: 16000, log: true, step: 1 }, lowpass: { lo: 40, hi: 16000, log: true, step: 1 },
  hpf: { lo: 20, hi: 8000, log: true, step: 1 }, hipass: { lo: 20, hi: 8000, log: true, step: 1 }, highpass: { lo: 20, hi: 8000, log: true, step: 1 },
  resonance: { lo: 0, hi: 30, step: 0.1 }, lpq: { lo: 0, hi: 30, step: 0.1 },
  room: { lo: 0, hi: 1, step: 0.01 }, reverb: { lo: 0, hi: 1, step: 0.01 }, delay: { lo: 0, hi: 1, step: 0.01 },
  delaytime: { lo: 0.01, hi: 1, step: 0.01 }, delayfeedback: { lo: 0, hi: 0.95, step: 0.01 },
  crush: { lo: 1, hi: 16, step: 1 }, bits: { lo: 1, hi: 16, step: 1 }, shape: { lo: 0, hi: 1, step: 0.01 }, distort: { lo: 0, hi: 1, step: 0.01 },
  attack: { lo: 0, hi: 2, step: 0.005 }, release: { lo: 0, hi: 3, step: 0.01 }, decay: { lo: 0, hi: 2, step: 0.01 }, sustain: { lo: 0, hi: 1, step: 0.01 },
  speed: { lo: 0.25, hi: 4, step: 0.01 }, octave: { lo: -2, hi: 4, step: 1 },
};
const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)';
export function findControls(code) {
  const m = maskComments(code), out = [];
  const names = Object.keys(CONTROLS).join('|');
  for (const hit of m.matchAll(new RegExp(`\\b(${names})\\s*:\\s*(${NUM})(?![\\w.])`, 'g'))) out.push(make(hit, 'option'));
  for (const hit of m.matchAll(new RegExp(`\\.(${names})\\(\\s*(${NUM})\\s*(?=[),])`, 'g'))) out.push(make(hit, 'method'));
  return out.sort((a, b) => a.from - b.from);
  function make(hit, how) {
    const text = hit[2];
    const at = m.indexOf(text, hit.index + hit[1].length);
    return { name: hit[1], how, from: at, to: at + text.length, value: Number(text), spec: CONTROLS[hit[1]] };
  }
}
export function formatNumber(v, step = 0.01) {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
  return String(Number(v.toFixed(decimals)));
}
// slider position (0..1) <-> value, linear or logarithmic
export const toPos = (spec, v) => { const c = Math.min(spec.hi, Math.max(spec.lo, v)); return spec.log ? Math.log(c / spec.lo) / Math.log(spec.hi / spec.lo) : (c - spec.lo) / (spec.hi - spec.lo); };
export const fromPos = (spec, p) => { const v = spec.log ? spec.lo * (spec.hi / spec.lo) ** p : spec.lo + p * (spec.hi - spec.lo); return Math.round(v / spec.step) * spec.step; };
