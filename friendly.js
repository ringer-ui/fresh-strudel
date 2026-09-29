// Friendly layer over Strudel: sensible defaults, plain-English names, one
// place to change key / tempo / drum kit. Everything returns normal Strudel
// patterns, so any Strudel method still chains on the end.

const DRUM_WORDS = {
  kick: 'bd', snare: 'sd', hat: 'hh', hihat: 'hh', closedhat: 'hh', openhat: 'oh',
  clap: 'cp', rim: 'rim', rimshot: 'rim', tom: 'mt', lowtom: 'lt', midtom: 'mt',
  hightom: 'ht', crash: 'cr', ride: 'rd', cowbell: 'cb',
};
const DRUM_RE = new RegExp(`\\b(${Object.keys(DRUM_WORDS).join('|')})\\b`, 'g');
const drumName = (w) => DRUM_WORDS[w] ?? w;
// "kick" or "kick:2" -> "bd" / "bd:2"
// (mini-notation parses "kick:2" into ["kick", 2])
const renameDrum = (v) => (Array.isArray(v) ? [renameDrum(v[0]), ...v.slice(1)]
  : typeof v === 'string' ? v.replace(/^[A-Za-z]+(?=:|$)/, drumName) : v);

// Strudel's transpiler turns every string literal into a mini-notation Pattern before our
// functions see it. These helpers get the plain values back out.
const isPattern = (x) => x && typeof x === 'object' && typeof x.queryArc === 'function';
function patternValues(pat, cycles = 1) {
  try {
    return pat.queryArc(0, cycles)
      .sort((a, b) => a.part.begin.compare(b.part.begin))
      .map((h) => h.value);
  } catch { return []; }
}
// A string, or a Pattern made from one -> the string (words joined by `sep`).
const plainString = (x, sep = ' ') => (isPattern(x) ? patternValues(x).join(sep) : String(x));
// Where each character of a drum row sits in the code you typed, so the editor can light up the step that is playing.
// A row is a string (a Pattern by the time we see it); Strudel recorded where the string starts. null where that isn't known.
function stepLocations(grid) {
  const out = [];
  for (const piece of Array.isArray(grid) ? grid : [grid]) {
    const str = plainString(piece, '').replace(/\s/g, '');
    let loc = null;
    try { loc = isPattern(piece) ? piece.queryArc(0, 1)[0]?.context?.locations?.[0] : null; } catch { /* no location */ }
    const exact = loc && Number.isInteger(loc.start) && loc.end - loc.start === str.length;   // only trust it when it matches the row's length
    for (let i = 0; i < str.length; i++) out.push(exact ? { start: loc.start + i, end: loc.start + i + 1 } : null);
  }
  return out;
}
const drumWords = (str) => (typeof str === 'string' ? str.replace(DRUM_RE, (w) => DRUM_WORDS[w]) : str);

// option name -> Strudel method, so you can write { vol: .5, reverb: .3 }
const OPTION_ALIASES = {
  vol: 'gain', volume: 'gain', filter: 'lpf', lowpass: 'lpf', hipass: 'hpf', highpass: 'hpf',
  reverb: 'room', bits: 'crush',
};

// Per-instrument defaults. Anything here can be overridden per call.
const DEFAULTS = {
  drums:  { vol: 0.9 },
  bass:   { sound: 'sawtooth', octave: 2, vol: 0.8, filter: 500, attack: 0.005, release: 0.2 },
  chords: { sound: 'sawtooth', vol: 0.4, filter: 1800, attack: 0.02, release: 0.4, reverb: 0.25 },
  pad:    { sound: 'sawtooth', vol: 0.3, filter: 1200, attack: 0.5, release: 1.5, reverb: 0.6 },
  lead:   { sound: 'triangle', octave: 4, vol: 0.6, attack: 0.01, release: 0.25, delay: 0.3, reverb: 0.2 },
};

export const KEY_MODES = ['minor', 'major', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'minor:pentatonic', 'major:pentatonic', 'blues'];

// "C minor", "Cm", "F# dorian", "Bb major", "A:minor:pentatonic" -> { root, mode }
export function parseKey(input) {
  const str = plainString(input).trim();
  const m = str.match(/^([A-Ga-g])([#b]?)\s*[: ]?\s*(.*)$/);
  if (!m) throw new Error(`key("${str}"): couldn't read that. Try key("C minor") or key("F# dorian").`);
  const root = m[1].toUpperCase() + m[2];
  let mode = m[3].trim().toLowerCase().replace(/\s+/g, ':');
  if (mode === '' || mode === 'maj' || mode === 'major') mode = 'major';
  else if (mode === 'm' || mode === 'min' || mode === 'minor') mode = 'minor';
  return { root, mode };
}

// setCps(cyclesPerSecond) is how tempo reaches the audio scheduler; the app passes repl.scheduler.setCps.
export function installFriendly(g = globalThis, { setCps } = {}) {
  const state = { bpm: 120, key: parseKey('C minor'), bank: null, lock: { bpm: false, key: false }, hasStrudelAliases: false };
  const fail = (msg) => { throw new Error(msg); };

  function setTempo(bpm) {
    if (!(bpm > 0)) fail(`tempo(${bpm}): give a number of beats per minute, like tempo(120).`);
    state.bpm = bpm;
    // 4 beats per bar, and one Strudel cycle = one bar.
    (setCps ?? g.setcps)(bpm / 60 / 4);
  }

  // Called before every run: put everything back to the UI's defaults.
  // lock: { bpm, key } = the top bar was touched last, so tempo()/key() in the code are ignored.
  function reset({ bpm = 120, key = 'C minor', bank = null, lock = {} } = {}) {
    state.lock = { bpm: !!lock.bpm, key: !!lock.key };
    state.key = parseKey(key);
    state.bank = bank;
    setTempo(bpm);
  }

  const scaleName = (octave) => `${state.key.root}${octave}:${state.key.mode}`;
  const NOTE_NAME = /^[a-gA-G][#b]?-?\d+$/;
  const looksLikeNotes = (p) => (isPattern(p)
    ? patternValues(p, 16).some((v) => typeof v === 'string' && NOTE_NAME.test(v))
    : typeof p === 'string' && /(^|[\s<\[(,*/])[a-gA-G][#b]?-?\d/.test(p));

  // Apply { vol, filter, reverb, ... } to a pattern; unknown keys go straight to Strudel.
  function applyOptions(pat, opts, skip = []) {
    for (const [k, v] of Object.entries(opts)) {
      if (skip.includes(k) || v === undefined || v === null) continue;
      const method = OPTION_ALIASES[k] ?? k;
      if (typeof pat[method] !== 'function') {
        fail(`Unknown option "${k}". Try vol, pan, filter, hipass, reverb, delay, attack, release, sound — or any Strudel method name.`);
      }
      pat = pat[method](v);
    }
    return pat;
  }

  // Notes (scale degrees or note names) -> a pattern with a synth on it.
  function melodic(kind, pattern, opts = {}) {
    const o = { ...DEFAULTS[kind], ...opts };
    const notes = o.notes ?? looksLikeNotes(pattern);
    let pat = notes ? g.note(pattern) : g.n(pattern).scale(scaleName(o.octave ?? 3));
    pat = pat.s(o.sound);
    return applyOptions(pat, o, ['sound', 'octave', 'notes']);
  }

  function bass(pattern, opts) { return melodic('bass', pattern, opts); }
  function lead(pattern, opts) { return melodic('lead', pattern, opts); }

  // Chord names -> voiced chords: chords("<Cm7 Fm7 G7 Cm7>")
  function chordsLike(kind, pattern, opts = {}) {
    const o = { ...DEFAULTS[kind], ...opts };
    let pat = g.chord(pattern).dict('ireal').voicing().s(o.sound);
    return applyOptions(pat, o, ['sound', 'octave']);
  }
  function chords(pattern, opts) { return chordsLike('chords', pattern, opts); }
  function pad(pattern, opts) { return chordsLike('pad', pattern, opts); }

  // drums("kick ~ snare ~")  or a step grid, one line per drum (16 steps = 1 bar):
  //   drums({ kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." })
  // Longer rows span several bars (16 steps each). x = hit, X = accent, o = ghost note, . or - = rest. No spaces inside a row (Strudel reads a lone "." as a separator).
  function drums(pattern, opts = {}) {
    const o = { ...DEFAULTS.drums, ...opts };
    if (state.bank && o.bank === undefined) o.bank = state.bank;
    let pat;
    const isGrid = pattern && typeof pattern === 'object' && typeof pattern.queryArc !== 'function';
    if (isGrid) {
      const parts = Object.entries(pattern).map(([name, grid]) => {
        // A row is one bar of 16 steps, or several bars: a longer string, or an array with one string per bar.
        const steps = [...(Array.isArray(grid) ? grid.map((b) => plainString(b, '')).join('') : plainString(grid, '')).replace(/\s/g, '')];
        if (!steps.length) fail(`drums: the "${name}" row came out empty. Write each row as one unbroken string with no spaces, e.g. "x...x...x...x...".`);
        const bad = steps.find((c) => !/[xXo.\-]/.test(c));
        if (bad) fail(`drums: "${bad}" in the "${name}" row isn't a step. Use x (hit), X (accent), o (ghost), . (rest).`);
        const snd = drumName(name);
        const hits = steps.map((c) => (/[xXo]/.test(c) ? snd : '~')).join(' ');
        const vol = o.vol ?? o.gain ?? 1;
        const level = steps.map((c) => (({ X: 1, x: 0.7, o: 0.35 }[c] ?? 0) * vol).toFixed(3)).join(' ');
        const where = stepLocations(grid);
        const row = where.length === steps.length && where.every(Boolean)
          ? g.seq(...steps.map((c, i) => (/[xXo]/.test(c) ? g.s(snd).gain(+(({ X: 1, x: 0.7, o: 0.35 }[c]) * vol).toFixed(3)).withContext((ctx) => ({ ...ctx, locations: [where[i]] })) : g.silence)))
          : g.s(hits).gain(level);
        return steps.length > 16 && steps.length % 16 === 0 ? row.slow(steps.length / 16) : row;   // N bars per cycle
      });
      pat = g.stack(...parts);
    } else {
      pat = g.s(isPattern(pattern) ? pattern.fmap(renameDrum) : drumWords(pattern));
    }
    return applyOptions(pat, o, isGrid ? ['vol', 'volume', 'gain'] : []);
  }

  // key("D minor"), tempo(96)
  function key(k) { const parsed = parseKey(k); if (!state.lock.key) state.key = parsed; return state.key; }
  function tempo(bpm) { if (!(bpm > 0)) fail(`tempo(${bpm}): give a number of beats per minute, like tempo(120).`); if (!state.lock.bpm) setTempo(bpm); return state.bpm; }

  Object.assign(g, { drums, bass, chords, pad, lead, key, tempo });

  // Chainable shortcuts on any pattern.
  const P = g.Pattern?.prototype;
  if (P && !state.hasStrudelAliases) {
    // Never shadow a real Strudel method (e.g. .filter and .echo already exist there).
    const add = (name, fn) => { if (!(name in P)) Object.defineProperty(P, name, { value: fn, writable: true, configurable: true }); };
    add('vol', function (v) { return this.gain(v); });
    add('hipass', function (v) { return this.hpf(v); });
    add('reverb', function (v) { return this.room(v); });
    add('bars', function (v) { return this.slow(v); });
    // .sweep(200, 4000, 8): filter opens and closes over 8 bars
    add('sweep', function (lo = 200, hi = 4000, bars = 8) { return this.lpf(g.sine.range(lo, hi).slow(bars)); });
    // .humanize(): tiny random timing offsets so it doesn't sound robotic
    add('humanize', function (amt = 0.02) { return this.late(g.rand.range(0, amt)); });
    state.hasStrudelAliases = true;
  }

  // Songs written in the Strudel REPL use inline visualisers and sliders that don't exist in this build.
  // Make them harmless no-ops so pasted songs still play.
  if (P) {
    for (const v of ['pianoroll', 'scope', 'punchcard', 'spiral', 'spectrum', 'pitchwheel', 'wordfall', 'markcss', 'draw']) {
      for (const name of [v, '_' + v]) {
        if (!(name in P)) Object.defineProperty(P, name, { value: function () { return this; }, writable: true, configurable: true });
      }
    }
  }
  // slider(value, min, max) is rewritten by the transpiler to sliderWithID(id, value, ...): just the starting value
  if (!g.slider) g.slider = (value) => value;
  if (!g.sliderWithID) g.sliderWithID = (id, value) => value;

  return { state, reset, setTempo };
}
