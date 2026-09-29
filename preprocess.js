// Turns "just write instruments" code into Strudel labelled tracks.
//
//   drums(...)            ->  drums: drums(...)
//   bass(...)             ->  bass: bass(...)
//   mybass: bass(...)     ->  (left alone, keeps your name)
//
// Muted tracks get a leading "_" (Strudel skips those). Line numbers never
// change, so error messages still point at the right line.

// Functions that start a track when they open a top-level statement.
export const TRACK_STARTERS = {
  drums: 'drums', bass: 'bass', chords: 'chords', pad: 'pad', lead: 'lead',
  s: 'sound', sound: 'sound', n: 'notes', note: 'notes', stack: 'stack',
  cat: 'cat', seq: 'seq', arrange: 'arrange', silence: 'silence',
};

// Split source into top-level statements. A statement starts on a line that
// begins at bracket depth 0 and isn't a continuation (.method, ), ], }, ,).
export function splitStatements(code) {
  const stmts = [];
  let depth = 0, quote = null, inBlock = false, inLine = false;
  let cur = null;
  let i = 0;
  const lineStart = (pos) => pos === 0 || code[pos - 1] === '\n';

  while (i < code.length) {
    const c = code[i], nx = code[i + 1];
    if (lineStart(i) && !quote && !inBlock) inLine = false;

    if (inLine) { if (c === '\n') inLine = false; i++; continue; }
    if (inBlock) { if (c === '*' && nx === '/') { inBlock = false; i += 2; } else i++; continue; }
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }

    // At the first significant character of a line, decide about a new statement.
    if (lineStart(i) && depth === 0 && c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
      const isComment = c === '/' && (nx === '/' || nx === '*');
      const isContinuation = /[.)\]},?:+\-*&|=]/.test(c) && !isComment;
      if (!isComment && !isContinuation) {
        if (cur) cur.end = i;
        cur = { start: i, end: code.length };
        stmts.push(cur);
      }
    }

    if (c === '/' && nx === '/') { inLine = true; i += 2; continue; }
    if (c === '/' && nx === '*') { inBlock = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    i++;
  }
  // "$drums:" on a line by itself owns the statement on the next line, so keep them together.
  const merged = [];
  for (const st of stmts) {
    const prev = merged[merged.length - 1];
    const prevText = prev ? code.slice(prev.start, prev.end).replace(/\/\/[^\n]*/g, '').trimEnd() : '';
    if (prev && /^[$\w]+\s*:$/.test(prevText)) prev.end = st.end;
    else merged.push({ ...st });
  }
  return merged.map((s) => ({ ...s, text: code.slice(s.start, s.end) }));
}

// Work out which statements are tracks and what to call them.
export function findTracks(code) {
  const used = new Set();
  const uniq = (base) => {
    let name = base, k = 2;
    while (used.has(name)) name = base + k++;
    used.add(name);
    return name;
  };
  const tracks = [];
  for (const st of splitStatements(code)) {
    const text = st.text;
    const label = text.match(/^(_?[A-Za-z]\w*|\$\w*)\s*:(?!:)/);
    if (label) {
      const raw = label[1];
      const muted = raw.startsWith('_');
      const name = raw === '$' ? uniq('track') : uniq(raw.replace(/^[_$]/, ''));
      tracks.push({ name, start: st.start, labelEnd: label[0].length + st.start, auto: false, dollar: raw.startsWith('$'), writtenMuted: muted, labelStart: st.start, labelLen: raw.length });
      continue;
    }
    const call = text.match(/^([A-Za-z]\w*)\s*\(/);
    if (call && TRACK_STARTERS[call[1]]) {
      tracks.push({ name: uniq(TRACK_STARTERS[call[1]]), start: st.start, auto: true, writtenMuted: false });
    }
  }
  return tracks;
}

// Build the code Strudel actually runs.
//   muted: Set of track names to silence.  solo: Set of names (if non-empty, only these play).
export function prepare(code, { muted = new Set(), solo = new Set() } = {}) {
  const tracks = findTracks(code);
  // Strudel's transpiler throws if the last statement is a function/class declaration
  // (songs often define helpers at the bottom). With labelled tracks the returned value is
  // ignored, so a trailing `silence` is harmless.
  const last = splitStatements(code).at(-1);
  if (tracks.length && last && /^(async\s+)?function\b|^class\b/.test(last.text)) code = code.replace(/\s*$/, '') + '\nsilence\n';
  const audible = (t) => (solo.size ? solo.has(t.name) : !muted.has(t.name)) && !t.writtenMuted;
  let out = '', pos = 0;
  const segments = [];                                          // stretches copied unchanged: prepared offset -> original offset
  const copy = (from, to) => { if (to > from) { segments.push({ out: out.length, from, to }); out += code.slice(from, to); } };
  for (const t of tracks) {
    if (t.auto) {
      copy(pos, t.start);
      out += (audible(t) ? '' : '_') + t.name + ': ';
      pos = t.start;
    } else {
      // Rewrite the existing label: $ -> unique name, and add/remove the mute underscore.
      copy(pos, t.labelStart);
      out += (audible(t) ? '' : '_') + t.name;
      pos = t.labelStart + t.labelLen;
    }
  }
  copy(pos, code.length);
  // Where a position in the prepared code sits in what you typed (null if it is text we added). Used to light up notes as they play.
  const toSource = (off) => { const g = segments.find((x) => off >= x.out && off < x.out + (x.to - x.from)); return g ? g.from + (off - g.out) : null; };
  return { code: out, tracks, toSource };
}
