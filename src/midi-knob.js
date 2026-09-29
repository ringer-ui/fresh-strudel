// Ties it together: a learned MIDI knob drives the number selected in the editor.
import { numberAt, createKnob } from './knob.js';
import { connectMidi, midiSupported } from './midi.js';

const KEY = 'strudel-easy:midi';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };

export function createMidiKnob({ editor, onEdited }) {
  const saved = load();
  const s = { supported: midiSupported(), enabled: false, devices: [], learning: false, cc: saved.cc ?? null, channel: saved.channel ?? null, mode: saved.mode ?? 'absolute', error: '', target: null };
  const knob = createKnob({ mode: s.mode });
  const subs = new Set(), emit = () => { for (const f of subs) f(); };
  let conn = null;

  const resolveTarget = () => {
    const sel = editor.selection();
    s.target = numberAt(editor.value, sel.from, sel.to);
    editor.markTarget(s.enabled && s.cc != null && s.target ? [s.target.from, s.target.to] : null);
  };
  editor.subscribe(() => { resolveTarget(); emit(); });

  function onCC({ channel, cc, value }) {
    if (s.learning) { Object.assign(s, { cc, channel, learning: false }); save({ cc, channel, mode: s.mode }); knob.reset(); resolveTarget(); emit(); return; }
    if (cc !== s.cc || (s.channel != null && channel !== s.channel)) return;
    resolveTarget();
    const text = knob.turn(value, s.target);
    if (text == null || text === editor.value.slice(s.target.from, s.target.to)) return;
    const from = s.target.from;
    editor.replace(from, s.target.to, text, 'knob');
    knob.follow(from);
    resolveTarget(); emit();
    onEdited();
  }

  const api = {
    state: s,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    async enable() {
      if (!s.supported) { s.error = 'This browser has no Web MIDI (use Chrome or Edge).'; emit(); return; }
      try {
        conn = await connectMidi({ onCC, onDevices: (d) => { s.devices = d; emit(); } });
        s.enabled = true; s.error = ''; save({ ...load(), enabled: true, mode: s.mode }); resolveTarget();
      } catch (e) { s.error = 'MIDI access was blocked. Allow it in the browser\'s site settings and try again.'; }
      emit();
    },
    disable() { conn?.close(); conn = null; Object.assign(s, { enabled: false, learning: false, devices: [] }); save({ ...load(), enabled: false }); resolveTarget(); emit(); },
    learn() { s.learning = !s.learning; emit(); },
    setMode(m) { s.mode = m; knob.setMode(m); save({ ...load(), cc: s.cc, channel: s.channel, mode: m }); emit(); },
    forget() { Object.assign(s, { cc: null, channel: null, learning: false }); save({ enabled: s.enabled, mode: s.mode }); resolveTarget(); emit(); },
  };
  if (saved.enabled && s.supported) api.enable();                    // reconnect quietly if permission was already granted
  return api;
}
