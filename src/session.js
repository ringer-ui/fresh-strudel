// The session: what is happening and what has happened. It keeps
//   - an activity log (edits, plays, errors, chat requests, library inserts...),
//   - versions of the song (automatic snapshots) and named scenes,
// and turns them into (a) the history/scenes panel and (b) a compact digest that goes to Claude with every chat message,
// so it knows what you did by hand since its last change, what it already tried, and which library examples it already used.
// No DOM here: storage and the clock are passed in, so it is tested in plain Node.
import { splitStatements, findTracks } from '../preprocess.js';

const MAX_EVENTS = 80, MAX_VERSIONS = 60, MAX_SCENES = 30, MAX_CHARS = 400_000, COALESCE_MS = 2500;

// ---- diffs ----
// Line diff (LCS). Songs are a few hundred lines at most, so the simple version is plenty.
export function lineDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: x[i++] });
    else out.push({ op: '+', text: y[j++] });
  }
  while (i < n) out.push({ op: '-', text: x[i++] });
  while (j < m) out.push({ op: '+', text: y[j++] });
  return out;
}
// The changed lines with `context` unchanged lines around them (for the panel and for Claude).
export function unifiedDiff(a, b, { context = 1, maxLines = 40 } = {}) {
  const d = lineDiff(a, b), keep = new Set();
  d.forEach((l, i) => { if (l.op !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) keep.add(k); });
  const lines = []; let gap = false;
  d.forEach((l, i) => { if (keep.has(i)) { if (gap) lines.push('  …'); lines.push(`${l.op} ${l.text}`); gap = false; } else if (lines.length) gap = true; });     // "…" only between two shown stretches
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `  … (${lines.length - maxLines} more lines)`].join('\n') : lines.join('\n');
}
// Which tracks changed, in plain words: { added, removed, changed, other } (track names; `other` = changes outside any track).
export function changedTracks(a, b) {
  const byName = (code) => {
    const stmts = splitStatements(code), map = new Map();
    for (const t of findTracks(code)) {
      const st = stmts.find((s) => s.start === t.start);
      if (st) map.set(t.name, st.text.trim());
    }
    return { map, rest: stmts.filter((s) => !findTracks(code).some((t) => t.start === s.start)).map((s) => s.text.trim()).join('\n') };
  };
  const A = byName(a), B = byName(b), out = { added: [], removed: [], changed: [], other: A.rest !== B.rest };
  for (const [name, text] of B.map) { if (!A.map.has(name)) out.added.push(name); else if (A.map.get(name) !== text) out.changed.push(name); }
  for (const name of A.map.keys()) if (!B.map.has(name)) out.removed.push(name);
  return out;
}
export function describeChange(a, b) {
  if (a === b) return 'no change';
  const c = changedTracks(a, b), parts = [];
  if (c.changed.length) parts.push(`changed ${c.changed.join(', ')}`);
  if (c.added.length) parts.push(`added ${c.added.join(', ')}`);
  if (c.removed.length) parts.push(`removed ${c.removed.join(', ')}`);
  if (c.other) parts.push('changed settings or helpers outside the tracks');
  return parts.join('; ') || 'edited whitespace or comments';
}

export function hashOf(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); }
export function ago(ms) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; }

const SOURCE_WORDS = { typing: 'you typed', visual: 'you used the visual editor', knob: 'you turned a MIDI knob', snippet: 'you added a snippet', claude: 'Claude', example: 'you loaded an example', import: 'you opened a file', library: 'you inserted a library example', restore: 'you restored a version', undo: 'you undid a change', scene: 'you switched scene', share: 'you opened a shared link' };
export const sourceWords = (s) => SOURCE_WORDS[s] ?? s;

// ---- the session ----
export function createSession({ storage = null, now = () => Date.now(), key = 'strudel-easy:session' } = {}) {
  let events = [], versions = [], scenes = [], seq = 1, name = 'Untitled', lastClaudeId = null, lastAsked = null;
  const used = new Map();                                       // library examples used this session: key -> { title, author, license }
  const started = now();
  const subs = new Set(), emit = () => { for (const f of subs) f(); };
  let saveTimer = null;

  try {
    const raw = storage?.getItem(key);
    if (raw) { const d = JSON.parse(raw); events = d.events ?? []; versions = d.versions ?? []; scenes = d.scenes ?? []; seq = d.seq ?? 1; name = d.name ?? name; }
  } catch { /* first run, or unreadable: start clean */ }

  const persist = () => {
    if (!storage) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // keep the newest versions within the size budget; named scenes are never dropped
      let total = versions.reduce((n, v) => n + v.code.length, 0) + scenes.reduce((n, v) => n + v.code.length, 0);
      while (total > MAX_CHARS && versions.length > 3) total -= versions.shift().code.length;
      try { storage.setItem(key, JSON.stringify({ events: events.slice(-MAX_EVENTS), versions, scenes, seq, name })); } catch { /* quota or blocked: history just won't survive a reload */ }
    }, 800);
  };

  const s = {
    get name() { return name; }, get events() { return events; }, get versions() { return versions; }, get scenes() { return scenes; },
    get lastClaudeId() { return lastClaudeId; }, get used() { return [...used.values()]; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    setName(n) { name = String(n).slice(0, 60) || 'Untitled'; persist(); emit(); },

    // kind: 'edit' | 'play' | 'stop' | 'error' | 'chat' | 'library' | 'scene' | ... ; text: one plain line
    record(kind, text, extra = {}) {
      const t = now(), last = events.at(-1);
      if (kind === 'edit' && last?.kind === 'edit' && last.source === extra.source && t - last.t < COALESCE_MS) { last.t = t; last.count = (last.count ?? 1) + 1; last.text = text; }
      else events.push({ t, kind, text, ...extra });
      if (events.length > MAX_EVENTS * 2) events = events.slice(-MAX_EVENTS);
      persist(); emit();
    },

    // A snapshot of the song. Skipped when nothing changed since the newest version (unless `force`).
    snapshot({ code, settings = {}, source = 'typing', label = '', sources = [], force = false }) {
      const hash = hashOf(code), newest = versions.at(-1);
      if (!force && newest && newest.hash === hash) { if (label && !newest.label) { newest.label = label; persist(); emit(); } return newest; }
      const v = { id: seq++, t: now(), code, hash, settings, source, label, sources };
      versions.push(v);
      if (versions.length > MAX_VERSIONS) versions.shift();
      if (source === 'claude') lastClaudeId = v.id;
      persist(); emit();
      return v;
    },
    version(id) { return versions.find((v) => v.id === id) ?? scenes.find((v) => v.id === id) ?? null; },

    saveScene({ code, settings = {}, name: sceneName }) {
      const n = String(sceneName ?? '').trim().slice(0, 40) || `Scene ${scenes.length + 1}`;
      const existing = scenes.find((x) => x.name === n);
      const v = { id: existing?.id ?? seq++, t: now(), code, hash: hashOf(code), settings, source: 'scene', label: n, name: n, sources: [] };
      if (existing) Object.assign(existing, v); else if (scenes.length < MAX_SCENES) scenes.push(v);
      s.record('scene', `saved scene "${n}"`);
      persist(); emit();
      return v;
    },
    deleteScene(id) { scenes = scenes.filter((x) => x.id !== id); persist(); emit(); },

    // Library examples the user or Claude used (so Claude doesn't offer the same one twice, and versions can credit them)
    noteLibrary(items) { for (const it of items ?? []) if (it?.title) used.set(it.id ?? it.title, { id: it.id, title: it.title, author: it.author ?? '', license: it.license ?? '' }); },

    // Called when a chat message is sent: remembers what the song looked like then.
    markAsked(code) { lastAsked = { code, t: now() }; },

    // ---- what Claude gets ----
    digest({ code = '', playing = false, playingSince = null, error = '', selection = '', maxChars = 3600 } = {}) {
      const t = now(), lines = [];
      lines.push(`scene: "${name}" · ${versions.length} saved version${versions.length === 1 ? '' : 's'}${scenes.length ? ` · scenes: ${scenes.map((x) => `"${x.name}"`).join(', ')}` : ''}`);
      lines.push(playing ? `now: playing${playingSince ? ` for ${ago(t - playingSince)}` : ''}` : 'now: stopped');
      if (error) lines.push(`unresolved error: ${error.split('\n')[0].slice(0, 200)}`);
      if (selection) lines.push(`the user has selected: ${selection}`);
      const mine = lastClaudeId != null ? s.version(lastClaudeId) : null;
      if (mine) {
        const d = mine.code === code ? 'nothing (the song is exactly as you left it)' : describeChange(mine.code, code);
        lines.push(`since your last change to the song (${ago(t - mine.t)} ago), the user did: ${d}`);
        if (mine.code !== code) lines.push('  (their edits are deliberate: keep them, build on them)');
      } else lines.push('you have not changed this song yet in this session');
      const recent = events.slice(-12);
      if (recent.length) { lines.push('recent activity (oldest first):'); for (const e of recent) lines.push(`- ${ago(t - e.t)} ago: ${e.text}${e.count > 1 ? ` (×${e.count})` : ''}`); }
      if (used.size) lines.push(`library examples already used this session: ${[...used.values()].map((u) => `"${u.title}"${u.author ? ` by ${u.author}` : ''}`).join('; ')} (prefer different ones unless asked)`);
      // small diffs of the latest versions, so it can see how the song has been evolving
      const vs = versions.slice(-4);
      const diffs = [];
      for (let i = 1; i < vs.length; i++) {
        const d = unifiedDiff(vs[i - 1].code, vs[i].code, { context: 0, maxLines: 8 });
        if (d) diffs.push(`v${vs[i].id} (${sourceWords(vs[i].source)}${vs[i].label ? `: ${vs[i].label}` : ''}, ${ago(t - vs[i].t)} ago):\n${d.split('\n').map((l) => '  ' + l).join('\n')}`);
      }
      if (diffs.length) lines.push('how the song changed recently:', ...diffs);
      let out = lines.join('\n');
      if (out.length > maxChars) {                                // too long: drop the oldest activity and diffs, keep the head (state) intact
        const head = lines.slice(0, lines.findIndex((l) => l.startsWith('recent activity')) >>> 0 || 6).join('\n');
        out = (head + '\n' + lines.slice(-6).join('\n')).slice(0, maxChars);
      }
      return out;
    },
    clear() { events = []; versions = []; scenes = []; used.clear(); lastClaudeId = null; persist(); emit(); },
    startedAt: started,
  };
  return s;
}
