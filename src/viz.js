// Live visuals under the editor: a scrolling piano roll of what is playing, a spectrum and a scope of what you hear.
// Light on purpose: it draws at most ~30 times a second, only while the song plays and the tab is visible, and the
// roll asks Strudel for events once per cycle (not per frame).

export const VIEW = { before: 0.5, after: 1.5 };           // cycles shown either side of "now"
export const FPS = 30;

// ---- pure helpers (tested without a browser) ----
const midiOfFreq = (f) => 12 * Math.log2(f / 440) + 69;
// Where an event belongs on the roll: a pitch, or a named drum lane. `toMidi` turns a note name into a number.
export function laneOf(value, toMidi) {
  if (!value || typeof value !== 'object') return null;
  const { note, freq, s } = value;
  if (note !== undefined) {
    const m = typeof note === 'number' ? note : (() => { try { return toMidi(note); } catch { return NaN; } })();
    if (Number.isFinite(m)) return { kind: 'note', midi: m };
  }
  if (typeof freq === 'number' && freq > 0) return { kind: 'note', midi: midiOfFreq(freq) };
  if (typeof s === 'string') return { kind: 'drum', name: s.replace(/^.*_/, '').replace(/:\d+$/, '') };   // "RolandTR909_bd:2" -> "bd"
  return null;
}
// Pitch range to draw, with breathing room and a minimum height so a single note isn't stretched over the whole strip.
export function pitchRange(events) {
  const ms = events.filter((e) => e.lane.kind === 'note').map((e) => e.lane.midi);
  if (!ms.length) return null;
  let lo = Math.floor(Math.min(...ms)) - 2, hi = Math.ceil(Math.max(...ms)) + 2;
  if (hi - lo < 12) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 6); hi = lo + 12; }
  return { lo, hi };
}
export const drumNames = (events) => [...new Set(events.filter((e) => e.lane.kind === 'drum').map((e) => e.lane.name))].sort();
// Rectangles for the roll (pixels). `now` in cycles; the playhead sits at before/(before+after) of the width.
export function layoutRoll(events, now, w, h, { drumH = 10 } = {}) {
  const span = VIEW.before + VIEW.after, t0 = now - VIEW.before, x = (c) => ((c - t0) / span) * w;
  const drums = drumNames(events), range = pitchRange(events);
  const drumsTotal = drums.length * drumH, noteH = Math.max(0, h - drumsTotal - (drums.length && range ? 2 : 0));
  const rects = [];
  for (const e of events) {
    if (e.end < t0 || e.begin > now + VIEW.after) continue;
    const x0 = x(e.begin), x1 = x(e.end), width = Math.max(2, x1 - x0 - 1);
    let y, height;
    if (e.lane.kind === 'note' && range) {
      height = Math.max(2, noteH / (range.hi - range.lo + 1) - 1);
      y = noteH - ((e.lane.midi - range.lo + 1) / (range.hi - range.lo + 1)) * noteH;
    } else if (e.lane.kind === 'drum') { height = drumH - 2; y = h - drumsTotal + drums.indexOf(e.lane.name) * drumH + 1; }
    else continue;
    rects.push({ x: x0, y, w: width, h: height, active: e.begin <= now && now < e.end, lane: e.lane, gain: e.gain, track: e.track });
  }
  return { rects, playheadX: x(now), drums };
}
// Log-spaced bands for the spectrum: [{ lo, hi }] as bin index ranges.
export function spectrumBands(bins, sampleRate, count = 48, fLo = 40, fHi = 16000) {
  const binHz = sampleRate / 2 / bins, out = [];
  for (let i = 0; i < count; i++) {
    const a = fLo * (fHi / fLo) ** (i / count), b = fLo * (fHi / fLo) ** ((i + 1) / count);
    const lo = Math.min(bins - 1, Math.floor(a / binHz)), hi = Math.min(bins, Math.max(lo + 1, Math.ceil(b / binHz)));
    out.push({ lo, hi });
  }
  return out;
}
const hueOf = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

// ---- the widget ----
export function createVisuals({ root, getScheduler, getCycle, getAnalyser, toMidi, store, trackAt = () => null }) {
  const canvas = root.querySelector('canvas'), g = canvas.getContext('2d');
  const buttons = [...root.querySelectorAll('button[data-m]')];
  let mode = store.get('viz', 'roll'), playing = false, timer = null;
  let events = [], cachedFor = null, cachedCycle = -1;
  let bands = null, freq = null, wave = null, peaks = null;
  const colors = {};
  const readColors = () => { const cs = getComputedStyle(document.documentElement); for (const k of ['bg', 'panel', 'line', 'text', 'dim', 'accent', 'accent-2']) colors[k] = cs.getPropertyValue('--' + k).trim() || '#888'; };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }
  function fetchEvents(s, now) {
    const c = Math.floor(now);
    if (s.pattern === cachedFor && c === cachedCycle) return;
    cachedFor = s.pattern; cachedCycle = c;
    events = [];
    try {
      for (const h of s.pattern.queryArc(c - 1, c + 3)) {
        if (!h.whole) continue;
        const lane = laneOf(h.value, toMidi);
        if (lane) events.push({ begin: Number(h.whole.begin), end: Number(h.whole.end), lane, gain: Math.min(1, Math.max(0.25, Number(h.value.gain ?? 1))), track: trackAt(h.context?.locations) });
      }
    } catch { events = []; }
  }
  function drawRoll({ w, h, dpr }) {
    const s = getScheduler(); if (!s?.pattern) return idle('Press Play');
    const now = getCycle(); fetchEvents(s, now);
    const { rects, playheadX, drums } = layoutRoll(events, now, w, h, { drumH: 13 * dpr });
    g.fillStyle = colors.bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = colors.line; g.lineWidth = 1;
    const span = VIEW.before + VIEW.after;
    for (let c = Math.ceil(now - VIEW.before); c <= now + VIEW.after; c++) { const x = ((c - (now - VIEW.before)) / span) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (const r of rects) {
      g.globalAlpha = 0.45 + 0.55 * r.gain;
      g.fillStyle = r.lane.kind === 'drum' ? `hsl(${hueOf(r.lane.name)} 70% ${r.active ? 72 : 55}%)` : r.track ? `hsl(${hueOf(r.track)} 75% ${r.active ? 75 : 58}%)` : (r.active ? colors.text : colors.accent);
      g.fillRect(r.x, r.y, r.w, r.h);
    }
    g.globalAlpha = 1;
    g.font = `${10 * dpr}px ui-monospace, monospace`; g.fillStyle = colors.dim;
    drums.forEach((n, i) => g.fillText(n, 4 * dpr, h - (drums.length - i) * 13 * dpr + 10 * dpr));
    g.strokeStyle = colors['accent-2']; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(playheadX, 0); g.lineTo(playheadX, h); g.stroke();
  }
  function drawSpectrum({ w, h, dpr }) {
    const an = getAnalyser(); if (!an) return idle('Press Play');
    if (!freq || freq.length !== an.frequencyBinCount) { freq = new Uint8Array(an.frequencyBinCount); bands = spectrumBands(an.frequencyBinCount, an.context.sampleRate); peaks = new Float32Array(bands.length); }
    an.getByteFrequencyData(freq);
    g.fillStyle = colors.bg; g.fillRect(0, 0, w, h);
    const bw = w / bands.length;
    bands.forEach((b, i) => {
      let m = 0; for (let k = b.lo; k < b.hi; k++) m = Math.max(m, freq[k]);
      const v = m / 255; peaks[i] = Math.max(v, peaks[i] - 0.02);
      g.fillStyle = colors.accent; g.fillRect(i * bw + 1, h - v * h, bw - 2, v * h);
      g.fillStyle = colors['accent-2']; g.fillRect(i * bw + 1, h - peaks[i] * h - 2 * dpr, bw - 2, 2 * dpr);
    });
  }
  function drawScope({ w, h, dpr }) {
    const an = getAnalyser(); if (!an) return idle('Press Play');
    if (!wave || wave.length !== an.fftSize) wave = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(wave);
    g.fillStyle = colors.bg; g.fillRect(0, 0, w, h);
    let start = 0; for (let i = 1; i < wave.length / 2; i++) if (wave[i - 1] < 128 && wave[i] >= 128) { start = i; break; }     // steady picture: start at a rising zero crossing
    const n = Math.min(1024, wave.length - start);
    g.strokeStyle = colors.accent; g.lineWidth = 1.5 * dpr; g.beginPath();
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * w, y = (wave[start + i] / 255) * h; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  function idle(text) {
    const { w, h, dpr } = resize();
    g.fillStyle = colors.bg; g.fillRect(0, 0, w, h);
    g.fillStyle = colors.dim; g.font = `${12 * dpr}px system-ui, sans-serif`; g.textAlign = 'center'; g.fillText(text, w / 2, h / 2); g.textAlign = 'start';
  }
  function frame() {
    if (mode === 'off') return;
    const size = resize();
    try { ({ roll: drawRoll, spectrum: drawSpectrum, scope: drawScope })[mode](size); } catch (e) { console.warn('visuals', e); }
  }
  function sync() {                                              // run the timer only when something is worth drawing
    const active = playing && mode !== 'off' && !document.hidden;
    if (active && !timer) { readColors(); timer = setInterval(frame, 1000 / FPS); }
    if (!active && timer) { clearInterval(timer); timer = null; }
    if (!active && mode !== 'off' && !document.hidden) { readColors(); idle(playing ? '' : 'Press Play to see and hear it'); }
    root.classList.toggle('collapsed', mode === 'off');
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
  }
  const setMode = (m) => { mode = m; store.set('viz', mode); events = []; cachedFor = null; sync(); };
  buttons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
  window.addEventListener('themechange', () => { readColors(); if (!timer && mode !== 'off') sync(); });
  document.addEventListener('visibilitychange', sync);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { readColors(); });
  new ResizeObserver(() => { if (!timer && mode !== 'off') sync(); }).observe(canvas);
  sync();
  return { setMode, setPlaying(p) { playing = p; events = []; cachedFor = null; sync(); }, get mode() { return mode; } };
}

// ---- inline visuals: one small roll per track, drawn into the canvases the editor puts under each track's code ----
// Strudel gives one combined pattern, so an event is assigned to a track by where in the code it came from (its location).
export function createInlineViz({ getCanvases, getScheduler, getCycle, toMidi, trackAt, store }) {
  let timer = null, playing = false, enabled = store.get('inline', '1') !== '0', events = [], cachedFor = null, cachedCycle = -1;
  const colors = {};
  const readColors = () => { const cs = getComputedStyle(document.documentElement); for (const k of ['panel', 'line', 'dim', 'text']) colors[k] = cs.getPropertyValue('--' + k).trim() || '#888'; };
  function fetchEvents(s, now) {
    const c = Math.floor(now);
    if (s.pattern === cachedFor && c === cachedCycle) return;
    cachedFor = s.pattern; cachedCycle = c; events = [];
    try {
      for (const h of s.pattern.queryArc(c - 1, c + 3)) {
        if (!h.whole) continue;
        const lane = laneOf(h.value, toMidi), track = trackAt(h.context?.locations);
        if (lane && track) events.push({ begin: Number(h.whole.begin), end: Number(h.whole.end), lane, track, gain: Math.min(1, Math.max(0.25, Number(h.value.gain ?? 1))) });
      }
    } catch { events = []; }
  }
  function frame() {
    const s = getScheduler(); if (!s?.pattern) return;
    const canvases = getCanvases(); if (!canvases.size) return;
    let now; try { now = getCycle(); } catch { return; }
    fetchEvents(s, now);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const [name, canvas] of canvases) {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const g = canvas.getContext('2d'), mine = events.filter((e) => e.track === name);
      const { rects, playheadX } = layoutRoll(mine, now, w, h, { drumH: 6 * dpr });
      g.fillStyle = colors.panel; g.fillRect(0, 0, w, h);
      g.strokeStyle = colors.line; g.lineWidth = 1;
      const span = VIEW.before + VIEW.after;
      for (let c = Math.ceil(now - VIEW.before); c <= now + VIEW.after; c++) { const x = ((c - (now - VIEW.before)) / span) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (const r of rects) {
        g.globalAlpha = 0.45 + 0.55 * r.gain;
        g.fillStyle = `hsl(${hueOf(name)} 75% ${r.active ? 76 : 58}%)`;
        g.fillRect(r.x, r.y, r.w, Math.max(r.h, 2 * dpr));
      }
      g.globalAlpha = 1; g.strokeStyle = colors.dim; g.lineWidth = dpr; g.beginPath(); g.moveTo(playheadX, 0); g.lineTo(playheadX, h); g.stroke();
    }
  }
  function sync() {
    const active = playing && enabled && !document.hidden;
    if (active && !timer) { readColors(); timer = setInterval(frame, 1000 / FPS); }
    if (!active && timer) { clearInterval(timer); timer = null; }
  }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('themechange', readColors);
  sync();
  return {
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; store.set('inline', on ? '1' : '0'); cachedFor = null; sync(); },
    setPlaying(p) { playing = p; cachedFor = null; sync(); },
  };
}
