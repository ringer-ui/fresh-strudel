import { installFriendly, KEY_MODES } from './friendly.js';
import { prepare, findTracks } from './preprocess.js';
import { EXAMPLES } from './examples.js';
import { SNIPPETS } from './snippets.js';
import { initChat } from './chat.js';
import { createEditor } from './src/editor.js';

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
const extraPanels = {};                            // name -> panel element, shown by showPanel
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
  onChange: () => onInput(), onRun: () => run(), onStop: () => stop(), getNames,
});

const setStatus = (msg) => { el.status.textContent = msg; };
const showError = (err) => { lastError = String(err?.message ?? err); el.error.hidden = false; el.error.textContent = lastError; editor?.setError(lastError); };
const hideError = () => { lastError = ''; el.error.hidden = true; el.error.textContent = ''; editor?.setError(null); };
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
let ranSource = '', toSource = () => null, lightTimer = null;
function lightNow() {
  const s = repl?.scheduler;
  if (!playing || document.hidden || !s?.pattern || editor.value !== ranSource) { editor.highlight([]); return; }
  try {
    const ctx = strudel.getAudioContext();
    const t = s.seconds_at_cps_change == null ? s.now() : s.num_cycles_at_cps_change + (ctx.currentTime - (ctx.outputLatency || 0) - s.seconds_at_cps_change - s.latency) * s.cps;
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
  startLights();
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
  stopLights();
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
const snippetsEl = $('snippets');
const chatEl = $('chat');
function showPanel(which) {   // 'help' | 'snippets' | 'chat' | 'pj' | null
  el.help.hidden = which !== 'help';
  for (const [name, node] of Object.entries(extraPanels)) node.hidden = which !== name;
  chatEl.hidden = which !== 'chat';
  snippetsEl.hidden = which !== 'snippets';
  store.set('panel', which ?? 'none');
}
el.helpToggle.addEventListener('click', () => showPanel(el.help.hidden ? 'help' : null));
$('chat-toggle').addEventListener('click', () => showPanel(chatEl.hidden ? 'chat' : null));
$('snippets-toggle').addEventListener('click', () => showPanel(snippetsEl.hidden ? 'snippets' : null));
showPanel(store.get('panel', 'help') === 'none' ? null : store.get('panel', 'help'));

// Snippet library: whole parts (Drums, Bass, ...) are added as a new track; Effects go on the end of the line you're on.
function addSnippet(category, code) {
  if (category === 'Effects') editor.insertAtLineEnd(code); else editor.append(code);   // both fire onChange (save, mixer)
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
  editor.setValue(await file.text());
  e.target.value = '';
  muted.clear(); solo.clear();
  onInput();
});

let mixTimer;
function onInput() {
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
  editor.setValue(text);
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

initChat({
  getCode: () => editor.value,
  setCode: (code) => { editor.setValue(code); onInput(); },   // 'input' saves, refreshes the mixer, hands tempo/key back to the code
  getContext: () => ({
    bpm: Number(el.bpm.value), key: currentKey(), bank: el.bank.value || null, playing,
    tracks: findTracks(editor.value).map((t) => t.name), muted: [...muted], solo: [...solo],
    extra: chatExtra(),
  }),
  run, isPlaying: () => playing, getLastError: () => lastError,
});


boot();
