import { installFriendly, KEY_MODES } from './friendly.js';
import { prepare, findTracks, splitStatements } from './preprocess.js';
import { EXAMPLES } from './examples.js';
import { SNIPPETS } from './snippets.js';
import { initChat } from './chat.js';
import { createEditor } from './src/editor.js';
import { mountVisual } from './src/VisualPanel.jsx';
import { mountHistory } from './src/HistoryPanel.jsx';
import { createMidiKnob } from './src/midi-knob.js';
import { createVisuals, createInlineViz } from './src/viz.js';
import { createSession } from './src/session.js';
import { numberAt } from './src/knob.js';
import { createDock, applyTheme, THEMES, makeVerticalResizer } from './src/workspace.js';
import { createPalette } from './src/palette.js';

const $ = (id) => document.getElementById(id);
const el = { play: $('play'), stop: $('stop'), bpm: $('bpm'), bpmOut: $('bpm-out'), root: $('key-root'), mode: $('key-mode'),
  bank: $('bank'), examples: $('examples'), share: $('share'), helpToggle: $('help-toggle'), help: $('help'),
  mixer: $('mixer'), error: $('error'), status: $('status'), beats: [...$('beats').children] };

const DRUM_BASE = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
const BANKS = ['RolandTR909', 'RolandTR808', 'RolandTR707', 'LinnDrum', 'AkaiLinn', 'RhythmAce', 'CasioRZ1', 'KorgMinipops', 'BossDR55', 'OberheimDMX', 'AlesisHR16'];
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MODE_LABELS = { 'minor:pentatonic': 'minor pentatonic', 'major:pentatonic': 'major pentatonic' };

const store = {
  get(k, d) { try { return localStorage.getItem('strudel-easy:' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('strudel-easy:' + k, v); } catch { /* private mode etc. */ } },
};

// ---- state ----
// Extension points the local app fills in (bottom of this file); the public build never sets them.
let barLocksHeld = () => false;                    // true while something external drives the top bar
let chatExtra = () => undefined;                   // optional extra context blocks for the chat
let beforeStart = () => {};                        // called just before playback begins from stopped
let readyResolve; const readyPromise = new Promise((r) => { readyResolve = r; });
let ready = false, playing = false, banksLoaded = false, evalFailed = false, soundfontsLoaded = false, lastError = '';
const muted = new Set(), solo = new Set();
let friendly;
// Set when the top bar was touched last (it then beats tempo()/key() in the code); cleared when the code is edited.
const lock = { bpm: false, key: false };

// ---- setup controls ----
ROOTS.forEach((r) => el.root.add(new Option(r, r)));
KEY_MODES.forEach((m) => el.mode.add(new Option(MODE_LABELS[m] ?? m, m)));
Object.keys(EXAMPLES).forEach((name) => el.examples.add(new Option(name, name)));

function fromHash() {
  try {
    const m = location.hash.match(/^#s=(.+)$/);
    return m ? JSON.parse(decodeURIComponent(escape(atob(m[1])))) : null;
  } catch { return null; }
}
const shared = fromHash();


el.bpm.value = shared?.bpm ?? store.get('bpm', 120);
el.root.value = shared?.root ?? store.get('root', 'C');
el.mode.value = shared?.mode ?? store.get('mode', 'minor');
el.bpmOut.textContent = el.bpm.value;

// ---- the code editor (CodeMirror 6; names for autocomplete come from the live Strudel engine) ----
const engineNames = () => {
  const s = window.strudel ?? {};
  const methods = new Set(Object.getOwnPropertyNames(s.Pattern?.prototype ?? {}).filter((n) => /^[a-zA-Z]/.test(n) && n !== 'constructor'));
  const sounds = Object.keys(s.soundMap?.get?.() ?? {}).filter((n) => !n.startsWith('_'));
  return { methods: [...methods].sort(), sounds: sounds.sort(), globals: [...new Set(['drums', 'bass', 'chords', 'pad', 'lead', 'tempo', 'key', ...Object.keys(s).filter((n) => /^[a-zA-Z]/.test(n))])].sort() };
};
const getNames = engineNames;                          // read live on each completion (a few ms), so sounds added later (banks, soundfonts, your own) appear
const editor = createEditor({
  parent: $('code'), doc: shared?.code ?? store.get('code', EXAMPLES['Start here']),
  onChange: (source) => onInput(source), onRun: () => run(), onStop: () => stop(), getNames,
});

// ---- the session: what is happening and what has happened (activity, versions, scenes). Claude sees a digest of it with every message. ----
const session = createSession({ storage: (() => { try { return localStorage; } catch { return null; } })() });
const settingsNow = () => ({ bpm: Number(el.bpm.value), root: el.root.value, mode: el.mode.value, bank: el.bank.value || '' });
let playingSince = null, lastErrorLogged = '';
const trackAtCursor = () => {                                  // the name of the track the cursor is in, for "the user has selected ..."
  const cur = editor.cursor(), code = editor.value;
  const st = splitStatements(code).findLast((x) => x.start <= cur);
  return st ? findTracks(code).find((t) => t.start === st.start)?.name ?? null : null;
};
function describeSelection() {
  const { from, to } = editor.selection(), code = editor.value, track = trackAtCursor();
  const where = track ? ` in track "${track}"` : '';
  if (to > from && to - from <= 80) return `"${code.slice(from, to).replace(/\s+/g, ' ')}"${where}`;
  const n = numberAt(code, from, to);
  if (n) return `the number ${n.name ? n.name + ' = ' : ''}${code.slice(n.from, n.to)}${where}`;
  return track ? `the cursor is in track "${track}"` : '';
}
const SOURCE_LINE = { typing: 'you typed', visual: 'you used the visual editor', knob: 'you turned a MIDI knob', slider: 'you moved a slider', snippet: 'you added a snippet', example: 'you loaded an example', import: 'you opened a file', library: 'you inserted a library example', restore: 'you restored a version', share: 'you opened a shared link' };
let idleSnap = null;
const snap = (source, extra = {}) => session.snapshot({ code: editor.value, settings: settingsNow(), source, ...extra });

const setStatus = (msg) => { el.status.textContent = msg; };
const showError = (err) => { lastError = String(err?.message ?? err); if (lastError !== lastErrorLogged) { lastErrorLogged = lastError; session.record('error', `an error came up: ${lastError.split('\n')[0].slice(0, 160)}`); } el.error.hidden = false; el.error.textContent = lastError; editor?.setError(lastError); };
const hideError = () => { lastError = ''; lastErrorLogged = ''; el.error.hidden = true; el.error.textContent = ''; editor?.setError(null); };
const currentKey = () => `${el.root.value} ${el.mode.value.replace(':', ' ')}`;

// ---- mixer (mute / solo chips built from the code) ----
function renderMixer() {
  const tracks = findTracks(editor.value);
  el.mixer.replaceChildren();
  if (!tracks.length) {
    el.mixer.append(Object.assign(document.createElement('span'), { className: 'empty', textContent: 'Tracks appear here once you add drums(), bass(), chords(), pad() or lead().' }));
    return;
  }
  for (const t of tracks) {
    const isMuted = muted.has(t.name) || t.writtenMuted;
    const chip = document.createElement('div');
    chip.className = 'track' + (isMuted || (solo.size && !solo.has(t.name)) ? ' muted' : '');
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: t.name });
    const mk = (label, cls, set, title, disabled = false) => {
      const b = Object.assign(document.createElement('button'), { textContent: label, title });
      b.className = cls + (set.has(t.name) ? ' on' : '');
      b.disabled = disabled;
      b.addEventListener('click', () => {
        set.has(t.name) ? set.delete(t.name) : set.add(t.name);
        renderMixer();
        if (playing) run();
      });
      return b;
    };
    chip.append(name, mk('M', 'm', muted, 'Mute', t.writtenMuted), mk('S', 's', solo, 'Solo'));
    el.mixer.append(chip);
  }
}

// ---- lighting up the notes that are sounding ----
// Strudel remembers where in the code each event came from (hap.context.locations, offsets into the code it evaluated);
// prepare() reports how those map back to what you typed. About 30 times a second, only while playing and the tab is visible.
// The cycle you are hearing right now (the scheduler runs ahead by its latency plus the device's own delay).
function audibleCycle() {
  const s = repl.scheduler, ctx = strudel.getAudioContext();
  return s.seconds_at_cps_change == null ? s.now() : s.num_cycles_at_cps_change + (ctx.currentTime - (ctx.outputLatency || 0) - s.seconds_at_cps_change - s.latency) * s.cps;
}
let analyser = null;                                          // taps the master output; created the first time visuals need it
function getAnalyser() {
  if (analyser || !master) return analyser;
  try { analyser = master.context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.7; master.connect(analyser); } catch (e) { console.warn('analyser unavailable', e); }
  return analyser;
}
let ranSource = '', toSource = () => null, lightTimer = null;
function lightNow() {
  const s = repl?.scheduler;
  if (!playing || document.hidden || !s?.pattern || editor.value !== ranSource) { editor.highlight([]); return; }
  try {
    const t = audibleCycle();
    const ranges = [];
    const pulse = 0.16 * s.cps;                                     // an event glows for ~160 ms after it starts (long sustained ones don't stay lit)
    for (const h of s.pattern.queryArc(t - pulse, t)) if (h.hasOnset()) for (const l of h.context?.locations ?? []) {
      const a = toSource(l.start), b = toSource(l.end - 1);
      if (a != null && b != null) ranges.push([a, b + 1]);
    }
    editor.highlight(ranges);
  } catch { editor.highlight([]); }
}
const startLights = () => { if (!lightTimer) lightTimer = setInterval(lightNow, 33); };
const stopLights = () => { clearInterval(lightTimer); lightTimer = null; editor.highlight([]); };

// Which track a note came from: its location (offset in the code Strudel ran) -> what you typed -> the track whose statement holds it.
let trackRanges = [];
const trackAt = (locations) => {                                 // an event has several locations (the label the app added, then the parts you typed): use the first that is yours
  for (const l of locations ?? []) {
    const src = toSource(l.start);
    if (src == null) continue;
    const r = trackRanges.find((x) => src >= x.start && src < x.end);
    if (r) return r.name;
  }
  return null;
};
const visuals = createVisuals({
  root: $('viz'), store, toMidi: (n) => strudel.noteToMidi(n), trackAt,
  getScheduler: () => repl?.scheduler, getCycle: () => audibleCycle(), getAnalyser: () => getAnalyser(),
});
const inline = createInlineViz({
  store, toMidi: (n) => strudel.noteToMidi(n), trackAt,
  getCanvases: () => editor.inlineCanvases(), getScheduler: () => repl?.scheduler, getCycle: () => audibleCycle(),
});
// Put (or take away) the small roll under each audible track's code.
function placeInline() {
  if (!playing || !inline.enabled) { editor.setInline([]); return; }
  const stmts = splitStatements(ranSource), doc = editor.value, list = [];
  trackRanges = [];
  for (const t of findTracks(ranSource)) {
    const st = stmts.find((x) => x.start === t.start);
    if (!st) continue;
    trackRanges.push({ name: t.name, start: t.start, end: st.end });
    if (t.writtenMuted || muted.has(t.name) || (solo.size && !solo.has(t.name))) continue;
    list.push({ pos: lineEnd(doc, st.end), name: t.name });                      // under the last line of the track's statement
  }
  editor.setInline(list);
}
const lineEnd = (doc, pos) => { const i = doc.indexOf('\n', Math.max(0, pos - 1)); return i < 0 ? doc.length : i; };
$('opt-inline').checked = inline.enabled;
$('opt-inline').addEventListener('change', (e) => { inline.setEnabled(e.target.checked); placeInline(); });
let slidersOn = store.get('sliders', '1') !== '0';
$('opt-sliders').checked = slidersOn; editor.setSliders(slidersOn);
$('opt-sliders').addEventListener('change', (e) => { slidersOn = e.target.checked; store.set('sliders', slidersOn ? '1' : '0'); editor.setSliders(slidersOn); });

// ---- running ----
// Returns true when the code evaluated without error.
async function run() {
  if (!ready) return false;
  hideError();
  ranSource = editor.value;
  const prepared = prepare(ranSource, { muted, solo });
  const { code } = prepared;
  toSource = prepared.toSource;
  installMasterGain();   // first Play only, inside the click, before any voice exists
  setMaster(1);
  try {
    friendly.reset({ bpm: Number(el.bpm.value), key: currentKey(), bank: banksLoaded ? el.bank.value || null : null, lock });
    evalFailed = false;
    if (!repl.scheduler.started) beforeStart();          // e.g. begin at the right point of a phrase
    await evaluate(code, true);
  } catch (e) {
    showError(e);
    return false;
  }
  if (evalFailed) return false;   // Strudel reports eval errors through onEvalError instead of throwing
  playing = true;
  startLights(); visuals.setPlaying(true); inline.setPlaying(true); placeInline();
  if (!playingSince) { playingSince = Date.now(); session.record('play', 'you pressed play'); }
  if (!liveRunning) snap('typing', { label: 'played' });          // live re-runs from knobs and the visual editor don't each make a version
  try {
    const ctx = strudel.getAudioContext();
    if (ctx.state !== 'running') await ctx.resume();          // browsers keep audio locked until a click
    if (ctx.state !== 'running') { setStatus('Audio is blocked by the browser. Click Play once more (or check the tab is not muted).'); return true; }
  } catch (e) { console.warn('could not resume audio', e); }
  syncControlsFromCode();
  const gm = [...new Set(editor.value.match(/\bgm_\w+/g) ?? [])];
  if (gm.length && !soundfontsLoaded) setStatus(`${el.status.textContent} Note: General-MIDI sounds (${gm.slice(0, 2).join(', ')}${gm.length > 2 ? ', …' : ''}) aren't available here and will be silent. Try sawtooth, triangle, square, sine or piano.`);
  return true;
}

// If the code calls tempo() / key(), show that in the top bar so nothing is hidden.
function syncControlsFromCode() {
  const { bpm, key } = friendly.state;
  const notes = [];
  if (lock.bpm || lock.key) {
    const what = [lock.bpm && 'tempo()', lock.key && 'key()'].filter(Boolean).join(' and ');
    setStatus(`Playing. The top bar is overriding ${what} in your code (edit the code to hand control back).`);
    return;
  }
  if (bpm !== Number(el.bpm.value)) { el.bpm.value = bpm; el.bpmOut.textContent = bpm; notes.push(`tempo(${bpm})`); }
  const k = `${key.root} ${key.mode}`;
  if (key.root !== el.root.value || key.mode !== el.mode.value) {
    if (ROOTS.includes(key.root)) el.root.value = key.root;
    if (KEY_MODES.includes(key.mode)) el.mode.value = key.mode;
    notes.push(`key("${k}")`);
  }
  setStatus(notes.length ? `Playing. ${notes.join(' and ')} in your code overrides the top bar.` : 'Playing. Edit, then Ctrl/Cmd+Enter to update.');
}

// Everything that reaches the speakers goes through one gain node we control. repl.stop() halts the clock, but notes
// already scheduled plus reverb/delay tails keep sounding for seconds; ramping this to 0 makes Stop instant.
let master = null, masterTried = false;
function installMasterGain() {
  if (masterTried) return;
  masterTried = true;                        // once only; if it fails we just go without a hard stop
  try {
    const ctx = strudel.getAudioContext();
    const connect = AudioNode.prototype.connect;
    const node = ctx.createGain();
    connect.call(node, ctx.destination);
    AudioNode.prototype.connect = function (dest, ...rest) {
      return connect.call(this, dest === ctx.destination && this !== node ? node : dest, ...rest);
    };
    master = node;
  } catch (e) {
    console.warn('master volume unavailable; Stop will use the normal stop only', e);
  }
}
function setMaster(level) {
  if (!master) return;
  try {
  const now = master.context.currentTime;
  master.gain.cancelScheduledValues(now);
  if (level === 0) master.gain.setTargetAtTime(0, now, 0.01);
  else master.gain.setValueAtTime(level, now);
  } catch (e) { console.warn('setMaster failed', e); }
}

function stop() {
  if (!ready) return;
  repl.stop();   // not the global hush(): that one only clears named patterns and leaves the clock running
  strudel.resetGlobalEffects?.();   // clears reverb/delay tails
  setMaster(0);
  playing = false;
  stopLights(); visuals.setPlaying(false); inline.setPlaying(false); editor.setInline([]);
  if (playingSince) session.record('stop', `you stopped it after ${Math.round((Date.now() - playingSince) / 1000)}s`);
  playingSince = null;
  setStatus('Stopped.');
}

let rerunTimer;
const rerunSoon = () => { if (playing) { clearTimeout(rerunTimer); rerunTimer = setTimeout(run, 150); } };

// ---- events ----
el.play.addEventListener('click', run);
el.stop.addEventListener('click', stop);
el.bpm.addEventListener('input', () => { lock.bpm = true; el.bpmOut.textContent = el.bpm.value; store.set('bpm', el.bpm.value); rerunSoon(); });
el.root.addEventListener('change', () => { lock.key = true; store.set('root', el.root.value); rerunSoon(); });
el.mode.addEventListener('change', () => { lock.key = true; store.set('mode', el.mode.value); rerunSoon(); });
el.bank.addEventListener('change', () => { store.set('bank', el.bank.value); rerunSoon(); });
const snippetsEl = $('snippets'), chatEl = $('chat'), visualEl = $('visual'), historyEl = $('history');
// Panels live in the dock (workspace.js): several can be open at once, resized, collapsed, and moved to either side.
const themeSel = $('theme');
for (const [k, v] of Object.entries(THEMES)) themeSel.add(new Option(k === 'system' ? 'Display: match system' : `Display: ${v}`, k));
const setTheme = (k) => { store.set('theme', k); themeSel.value = applyTheme(k); };
setTheme(store.get('theme', 'system'));
themeSel.addEventListener('change', () => setTheme(themeSel.value));
const toolbar = { help: el.helpToggle, chat: $('chat-toggle'), visual: $('visual-toggle'), history: $('history-toggle'), snippets: $('snippets-toggle') };
let dock = null;
const syncToolbar = () => { if (!dock) return; for (const [name, b] of Object.entries(toolbar)) { const on = dock.isOpen(name); b.classList.toggle('panel-on', on); b.setAttribute('aria-pressed', String(on)); } };
dock = createDock({ root: $('dock'), store, onChange: () => syncToolbar() });
dock.register('help', el.help, 'Cheat sheet'); dock.register('chat', chatEl, 'Chat'); dock.register('visual', visualEl, 'Visual editors');
dock.register('history', historyEl, 'History and scenes'); dock.register('snippets', snippetsEl, 'Snippets');
for (const [name, b] of Object.entries(toolbar)) b.addEventListener('click', () => dock.toggle(name));
syncToolbar();
makeVerticalResizer({ handle: $('viz-resize'), target: $('viz'), prop: '--viz-h', min: 80, max: 520, store, key: 'viz-h' });

// Visual editors: every click/drag is an exact text edit in the editor; if the song is playing the change is heard right away.
// Re-runs at most ~6 times a second, one at a time (a knob sends far more than that).
let liveTimer, liveLast = 0, liveBusy = false, liveAgain = false, liveRunning = false;
async function liveRun() {
  if (!playing) return;
  if (liveBusy) { liveAgain = true; return; }
  liveBusy = true; liveLast = performance.now();
  liveRunning = true;
  try { await run(); } finally { liveRunning = false; liveBusy = false; if (liveAgain) { liveAgain = false; liveEdited(); } }
}
function liveEdited() { clearTimeout(liveTimer); liveTimer = setTimeout(liveRun, Math.max(0, 160 - (performance.now() - liveLast))); }
const midi = createMidiKnob({ editor, onEdited: liveEdited });
mountVisual(visualEl, { editor, onEdited: liveEdited, midi });

// History and scenes. Restoring or switching always keeps the song you had (as a version) first, so nothing is ever lost.
function applyVersion(v, source = 'restore', { quiet = false } = {}) {
  if (!quiet) snap('typing', { label: 'before restore' });
  const st = v.settings ?? {};
  if (st.bpm) { el.bpm.value = st.bpm; el.bpmOut.textContent = st.bpm; }
  if (st.root) el.root.value = st.root;
  if (st.mode) el.mode.value = st.mode;
  if (st.bank != null && [...el.bank.options].some((o) => o.value === st.bank)) el.bank.value = st.bank;
  muted.clear(); solo.clear();
  editor.setValue(v.code);
  onInput('restore');
  if (!quiet) session.record('restore', `you ${source === 'scene' ? `switched to scene "${v.name}"` : `restored v${v.id}${v.label ? ` (${v.label})` : ''}`}`);
  renderMixer();
  if (playing) run();
}
mountHistory(historyEl, {
  session, apply: applyVersion,
  current: () => ({ code: editor.value, settings: settingsNow() }),
  digest: () => session.digest({ code: editor.value, playing, playingSince, error: lastError, selection: describeSelection() }),
});

// Snippet library: whole parts (Drums, Bass, ...) are added as a new track; Effects go on the end of the line you're on.
function addSnippet(category, code) {
  if (category === 'Effects') editor.insertAtLineEnd(code, 'snippet'); else editor.append(code, 'snippet');   // both fire onChange (save, mixer)
  if (playing) run();
}
for (const [category, items] of Object.entries(SNIPPETS)) {
  const h = Object.assign(document.createElement('h3'), { textContent: category });
  const list = document.createElement('div');
  list.className = 'snips';
  for (const [name, code] of Object.entries(items)) {
    const b = Object.assign(document.createElement('button'), { textContent: name, title: code });
    b.addEventListener('click', () => addSnippet(category, code));
    list.append(b);
  }
  snippetsEl.append(h, list);
}

// Save / open .strudel files (plain text, so they also open in the Strudel REPL)
$('export').addEventListener('click', () => {
  const header = `// tempo ${el.bpm.value} bpm, key ${currentKey()}\n`;
  const url = URL.createObjectURL(new Blob([header + editor.value], { type: 'text/plain' }));
  Object.assign(document.createElement('a'), { href: url, download: 'song.strudel' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  snap('typing');                                  // keep what was there
  editor.setValue(await file.text());
  e.target.value = '';
  muted.clear(); solo.clear();
  onInput('import');
});

let mixTimer;
function onInput(source = 'typing') {
  if (source === 'slider') liveEdited();                          // an inline slider: hear it right away
  if (!['claude', 'undo', 'restore', 'library'].includes(source)) session.record('edit', SOURCE_LINE[source] ?? source, { source });      // Claude's and undo have their own lines from the chat
  clearTimeout(idleSnap); idleSnap = setTimeout(() => snap(source === 'typing' ? 'typing' : source), 15000);     // a version once you pause (plays and chat changes make their own)
  if (!barLocksHeld()) lock.bpm = lock.key = false;         // while something external drives the top bar, edits don't hand it back
  store.set('code', editor.value);
  clearTimeout(mixTimer);
  mixTimer = setTimeout(renderMixer, 200);
}

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); stop(); }
});

// Songs generated from stemrack MIDI (tools/stemrack2strudel.py) show up under their own heading.
const songCache = new Map();
const PUBLIC = !!window.STRUDEL_EASY?.public;
if (!PUBLIC) fetch('songs/index.json').then((r) => (r.ok ? r.json() : [])).then((songs) => {
  if (!songs.length) return;
  const group = document.createElement('optgroup');
  group.label = 'From stemrack';
  songs.forEach((s) => group.append(new Option(s.name, 'song:' + s.file)));
  el.examples.append(group);
  songs.forEach((s) => songCache.set('song:' + s.file, fetch('songs/' + s.file).then((r) => r.text())));
}).catch(() => {});

el.examples.addEventListener('change', async () => {
  const name = el.examples.value;
  el.examples.value = '';
  if (!name) return;
  const text = name.startsWith('song:') ? await songCache.get(name) : EXAMPLES[name];
  const known = [...Object.values(EXAMPLES), ...(await Promise.all(songCache.values()))];
  if (!known.includes(editor.value) && editor.value.trim() && !confirm('Replace what you have with this example?')) return;
  muted.clear(); solo.clear(); lock.bpm = lock.key = false;
  snap('typing');                                  // keep what was there
  editor.setValue(text);
  onInput('example');
  store.set('code', editor.value);
  renderMixer();
  if (playing) run();
});

el.share.addEventListener('click', async () => {
  const data = { code: editor.value, bpm: Number(el.bpm.value), root: el.root.value, mode: el.mode.value };
  const url = `${location.origin}${location.pathname}#s=${btoa(unescape(encodeURIComponent(JSON.stringify(data))))}`;
  try { await navigator.clipboard.writeText(url); setStatus('Link copied. It contains the whole song.'); }
  catch { location.hash = '#s=' + url.split('#s=')[1]; setStatus('Link is in the address bar.'); }
});

// ---- beat indicator ----
let repl;
function tick() {
  let beat = -1;
  if (playing && repl?.scheduler?.started) {
    const cycle = repl.scheduler.now();
    beat = Math.floor((((cycle % 1) + 1) % 1) * 4);
  }
  el.beats.forEach((d, i) => d.classList.toggle('on', i === beat));
  requestAnimationFrame(tick);
}

// ---- surface unexpected failures (otherwise "nothing happens") ----
window.addEventListener('error', (e) => showError(`Script error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => showError(`Script error: ${e.reason?.message ?? e.reason}`));

// ---- boot ----
async function boot() {
  el.play.disabled = true;
  renderMixer();
  try {
    repl = await initStrudel({
      onEvalError: (e) => { evalFailed = true; showError(e); },
      prebake: async () => {
        setStatus('Loading sounds…');
        await samples('github:tidalcycles/dirt-samples');
        // Same extra banks the Strudel REPL loads, so pasted songs find their sounds. Failures aren't fatal.
        const extras = ['piano', 'EmuSP12', 'vcsl', 'mridangam'].map((n) => samples(`${DRUM_BASE}/${n}.json`));
        Promise.allSettled(extras).then((r) => r.some((x) => x.status === 'rejected') && console.warn('some extra sample banks failed to load'));
        try {   // General-MIDI instruments (gm_piano, gm_flute, ...); the font files load when first played
          const sf = await import(/* @vite-ignore */ './vendor/soundfonts.mjs');
          await sf.registerSoundfonts();
          soundfontsLoaded = true;
        } catch (e) { console.warn('gm_ soundfonts unavailable', e); }
        try {
          await samples(`${DRUM_BASE}/tidal-drum-machines.json`);
          banksLoaded = true;
          // short names such as dr550_bd, rm50_hh
          await aliasBank('https://raw.githubusercontent.com/todepond/samples/main/tidal-drum-machines-alias.json').catch(() => {});
        } catch (e) {
          console.warn('Drum machine banks failed to load; using default samples.', e);
        }
      },
    });
  } catch (e) {
    showError(`Couldn't start Strudel: ${e.message}`);
    setStatus('Failed to start.');
    return;
  }

  window.strudelRepl = repl;   // handy for poking around in the console
  el.bank.replaceChildren(new Option('Default samples', ''));
  if (banksLoaded) {
    BANKS.forEach((b) => el.bank.add(new Option(b, b)));
    el.bank.value = shared?.bank ?? store.get('bank', 'RolandTR909');
    if (el.bank.value !== (shared?.bank ?? store.get('bank', 'RolandTR909'))) el.bank.value = 'RolandTR909';
  } else {
    el.bank.disabled = true;
    setStatus('Ready (drum kits unavailable offline; using default samples). Press Play.');
  }

  friendly = installFriendly(globalThis, { setCps: (cps) => repl.scheduler.setCps(cps) });
  ready = true;
  readyResolve();
  el.play.disabled = false;
  if (banksLoaded) setStatus('Ready. Press Play, or Ctrl/Cmd+Enter.');
  if (PUBLIC && shared?.code) setStatus('Loaded from a shared link. Its code runs in your browser when you press Play, so only press Play on links you trust.');
  requestAnimationFrame(tick);
}

const chatApi = initChat({
  getCode: () => editor.value,
  setCode: (code, source) => { editor.setValue(code); onInput(source ?? 'typing'); },   // 'input' saves, refreshes the mixer, hands tempo/key back to the code
  getContext: () => ({
    bpm: Number(el.bpm.value), key: currentKey(), bank: el.bank.value || null, playing,
    tracks: findTracks(editor.value).map((t) => t.name), muted: [...muted], solo: [...solo],
    extra: chatExtra(),
    session: session.digest({ code: editor.value, playing, playingSince, error: lastError, selection: describeSelection() }),
    libraryUsed: session.used.map((u) => u.id).filter(Number.isFinite),
  }),
  session,
  run, isPlaying: () => playing, getLastError: () => lastError,
});

// ---- command palette (Cmd/Ctrl+K). Anything that isn't a command can be sent straight to Claude. ----
const askClaude = (text) => { dock.open('chat'); chatApi.send(text); };
const palette = createPalette({
  onAsk: askClaude,
  getCommands: () => [
    { title: 'Play / update', hint: '⌘↵', run: () => run() }, { title: 'Stop', hint: '⌘.', run: () => stop() },
    ...dock.titles().map(({ name, title }) => ({ title: `${dock.isOpen(name) ? 'Close' : 'Open'} ${title}`, hint: 'panel', keywords: 'panel toggle show hide dock', run: () => dock.toggle(name) })),
    { title: `Move the panels to the ${dock.side === 'left' ? 'right' : 'left'}`, hint: 'layout', keywords: 'dock side', run: () => dock.setSide(dock.side === 'left' ? 'right' : 'left') },
    ...Object.entries(THEMES).map(([k, v]) => ({ title: `Theme: ${v}`, hint: 'look', run: () => setTheme(k) })),
    ...[['roll', 'Piano roll'], ['spectrum', 'Spectrum'], ['scope', 'Scope'], ['off', 'Hide']].map(([m, t]) => ({ title: `Visuals: ${t}`, hint: 'look', run: () => visuals.setMode(m) })),
    ...session.scenes.map((v) => ({ title: `Scene: ${v.name}`, hint: 'scene', run: () => applyVersion(v, 'scene') })),
    { title: 'Save the song as a scene…', hint: 'scene', run: () => { const n = prompt('Scene name'); if (n) session.saveScene({ code: editor.value, settings: settingsNow(), name: n }); } },
    ...session.versions.slice(-8).reverse().map((v) => ({ title: `Restore v${v.id}${v.label ? `: ${v.label}` : ''}`, hint: 'history', keywords: 'version undo back', run: () => applyVersion(v, 'restore') })),
    ...Object.keys(EXAMPLES).map((n) => ({ title: `Example: ${n}`, hint: 'example', run: () => { el.examples.value = n; el.examples.dispatchEvent(new Event('change')); } })),
    { title: 'Select the next number', hint: 'Alt N', keywords: 'variable parameter jump', run: () => editor.jumpNumber(1) },
    { title: 'Select the previous number', hint: 'Alt P', keywords: 'variable parameter jump', run: () => editor.jumpNumber(-1) },
    { title: `Inline visuals: ${inline.enabled ? 'turn off' : 'turn on'}`, hint: 'look', run: () => $('opt-inline').click() },
    { title: `Inline sliders: ${slidersOn ? 'turn off' : 'turn on'}`, hint: 'look', run: () => $('opt-sliders').click() },
    { title: 'Faster (+5 BPM)', hint: 'tempo', run: () => { el.bpm.value = Math.min(220, Number(el.bpm.value) + 5); el.bpm.dispatchEvent(new Event('input')); } },
    { title: 'Slower (−5 BPM)', hint: 'tempo', run: () => { el.bpm.value = Math.max(40, Number(el.bpm.value) - 5); el.bpm.dispatchEvent(new Event('input')); } },
    { title: 'Save the song as a file', hint: 'file', run: () => $('export').click() }, { title: 'Copy a share link', hint: 'file', run: () => $('share').click() },
  ],
});



boot();
