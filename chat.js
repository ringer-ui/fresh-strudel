// Chat panel: asks Claude for changes, applies the returned song to the editor and hot-swaps it if playing.
// Two transports, same events ({type:'text'|'code'|'error'|'done'}):
//   local server (npm start): POST /api/chat, the server holds the API key
//   public build (config.js sets public: true): straight from the browser with the visitor's own key (chat-direct.js)
const MAX_AUTO_FIXES = 2;
const PUBLIC = !!window.STRUDEL_EASY?.public;
const KEY_NAME = 'strudel-easy:anthropic-key';

// The key is held in memory by default (gone on reload, and out of reach of code running in a pasted song, which can read
// browser storage). Ticking "Keep it" stores it in this browser's local storage instead.
let memoryKey = '';
const stored = () => { try { return localStorage.getItem(KEY_NAME) || ''; } catch { return ''; } };
const getKey = () => memoryKey || stored();
const forgetKey = () => { memoryKey = ''; try { localStorage.removeItem(KEY_NAME); } catch { /* storage blocked */ } };

async function* serverEvents({ messages, code, context, signal, model,
}) {
  const res = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ messages, code, context, model,
    }),
  });
  if (!res.ok) throw new Error(`server said ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (line.startsWith('data: ')) yield JSON.parse(line.slice(6));
    }
  }
}

const SUGGESTIONS = ['Make it faster', 'Add a bassline', 'Make the drums heavier', 'Darker mood', 'More reverb on the lead', 'Swap to an 808 kit'];

export function initChat({ getCode, setCode, getContext, run, isPlaying, getLastError, openPanel, session }) {
  const $ = (id) => document.getElementById(id);
  const log = $('chat-log'), input = $('chat-input'), sendBtn = $('chat-send'), undoBtn = $('chat-undo'), clearBtn = $('chat-clear');

  const modelSel = $('chat-model');
  const MODEL_KEY = 'strudel-easy:chat-model';
  const currentModel = () => modelSel.value;
  (async () => {                                    // the list comes from the one shared definition (chat-prompt.mjs), so the picker can't drift from what the API path accepts
    const { MODELS, DEFAULT_MODEL, pickModel } = await import('./chat-prompt.mjs');
    for (const [id, m] of Object.entries(MODELS)) modelSel.add(new Option(m.label, id));
    let saved = ''; try { saved = localStorage.getItem(MODEL_KEY) || ''; } catch { /* storage blocked */ }
    modelSel.value = pickModel(saved || DEFAULT_MODEL);
  })();
  modelSel.addEventListener('change', () => { try { localStorage.setItem(MODEL_KEY, modelSel.value); } catch { /* ignore */ } });

  const history = [];        // [{role, content}] as sent to the server (text only)
  const undoStack = [];      // songs before each AI edit
  let busy = false, abort = null, enabled = true;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const bubble = (role, text = '') => { const b = el('div', `msg ${role}`, text); log.append(b); scroll(); return b; };

  function empty() {
    log.replaceChildren();
    const box = el('div', 'chat-empty');
    box.append(el('p', null, 'Tell me what to change and I\'ll edit the song. If it\'s playing, the change is swapped in live.'));
    const row = el('div', 'chips');
    for (const s of SUGGESTIONS) { const b = el('button', null, s); b.addEventListener('click', () => send(s)); row.append(b); }
    box.append(row);
    log.append(box);
  }


  function refreshButtons() {
    sendBtn.textContent = busy ? 'Stop' : 'Send';
    sendBtn.classList.toggle('primary', !busy);
    undoBtn.disabled = busy || undoStack.length === 0;
    input.disabled = !enabled;
  }

  // One request (plus any automatic fix-ups) is one undo step: only the first apply snapshots.
  function applySong(code, snapshot, note = {}) {
    if (snapshot) undoStack.push(getCode());
    session?.snapshot({ code: getCode(), source: 'typing', label: 'before Claude changed it' });      // the state Claude started from (skipped if it is already a version)
    setCode(code, 'claude');
    session?.snapshot({ code, source: 'claude', label: note.summary || 'Claude changed the song', sources: note.sources ?? [], force: true });
    if (note.sources?.length) session?.noteLibrary(note.sources);
    session?.record('chat', `Claude: ${note.summary || 'changed the song'}${note.sources?.length ? ` (drew on ${note.sources.map((x) => `"${x.title}"`).join(', ')})` : ''}`);
    refreshButtons();
  }

  // One request/response cycle. Returns { code, text, error }.
  async function ask(userText, { snapshot = true } = {}) {
    history.push({ role: 'user', content: userText });
    if (snapshot) { session?.record('chat', `you asked Claude: "${userText.slice(0, 120)}"`); session?.markAsked(getCode()); }
    const msgEl = bubble('assistant');
    msgEl.classList.add('pending');
    let text = '', code = null, summary = '', error = null;
    let sources = [];                                  // library examples Claude drew on (local app only ever fills this)

    abort = new AbortController();
    try {
      const req = { messages: history, code: getCode(), context: getContext(), signal: abort.signal, model: currentModel(),
      };
      const events = PUBLIC ? (await import('./chat-direct.js')).streamChat({ ...req, apiKey: getKey() }) : serverEvents(req);
      for await (const ev of events) {
        if (ev.type === 'text') { text += ev.delta; msgEl.textContent = text; scroll(); }
        else if (ev.type === 'code') { code = ev.code; summary = ev.summary; }
        else if (ev.type === 'error') error = ev.message;
      }
    } catch (e) {
      if (e.name !== 'AbortError') error = e.message;
      else error = 'Stopped.';
    }
    msgEl.classList.remove('pending');
    if (!text) msgEl.remove();
    history.push({ role: 'assistant', content: (text || summary || '(no reply)') + (code ? '\n(I updated the song.)' : '') });
    if (code) {
      applySong(code, snapshot, { summary, sources });
      const note = el('div', 'msg applied', `✓ ${summary || 'Song updated'}`);
      log.append(note);
      scroll();
    }
    if (error) bubble('error', error);
    return { code, error };
  }

  async function send(text) {
    text = (text ?? input.value).trim();
    if (!text || busy || !enabled) return;
    input.value = '';
    log.querySelector('.chat-empty')?.remove();
    bubble('user', text);
    busy = true; refreshButtons();
    try {
      let { code, error } = await ask(text);
      // If it was playing, apply it live, and if the new code doesn't evaluate let Claude fix its own mistake.
      for (let attempt = 0; code && !error && attempt <= MAX_AUTO_FIXES; attempt++) {
        if (!isPlaying()) break;                 // when stopped we can't check without starting playback
        const ok = await run();
        if (ok) break;
        if (attempt === MAX_AUTO_FIXES) { bubble('error', 'That version still has an error; the previous song is one Undo away.'); break; }
        const err = getLastError() || 'unknown error';
        log.append(el('div', 'msg note', `Error: ${err.split('\n')[0]}. Asking Claude to fix it…`)); scroll();
        ({ code, error } = await ask(`The song you just wrote failed to run with this error:\n${err}\nFix that error and change nothing else.`, { snapshot: false }));
      }
    } finally {
      busy = false; abort = null; refreshButtons(); input.focus();
    }
  }

  sendBtn.addEventListener('click', () => (busy ? abort?.abort() : send()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    e.stopPropagation();                         // don't trigger the editor's shortcuts from here
  });
  undoBtn.addEventListener('click', async () => {
    const prev = undoStack.pop();
    if (prev == null) return;
    setCode(prev, 'undo');
    session?.record('chat', 'you undid Claude\'s last change');
    session?.snapshot({ code: prev, source: 'undo', label: 'undid Claude\'s change' });
    log.append(el('div', 'msg note', 'Undid the last change.')); scroll();
    history.push({ role: 'user', content: '(I undid your last change with the Undo button.)' }, { role: 'assistant', content: 'OK, reverted.' });
    refreshButtons();
    if (isPlaying()) await run();
  });
  clearBtn.addEventListener('click', () => { history.length = 0; undoStack.length = 0; empty(); refreshButtons(); });

  empty(); refreshButtons();
  if (PUBLIC) setupKeyBox();
  else fetch('/api/status').then((r) => r.json()).then((s) => {
    if (s.chat) { input.placeholder = 'e.g. "make the bass wobblier" (Enter to send)'; return; }
    enabled = false; refreshButtons();
    log.replaceChildren(el('div', 'msg error', 'Chat is off: the server has no ANTHROPIC_API_KEY. Start it from a terminal that has the key exported (npm start), then reload.'));
  }).catch(() => { enabled = false; refreshButtons(); log.replaceChildren(el('div', 'msg error', 'Chat needs the Strudel Easy server (npm start); it isn\'t reachable from here.')); });

  // Public build: the visitor pastes their own key. It stays in this browser (this tab, or this device if they tick
  // "remember") and is only ever sent to api.anthropic.com.
  function setupKeyBox() {
    const box = $('chat-key'), keyInput = $('key-input'), remember = $('key-remember'), status = $('key-status');
    box.hidden = false;
    const sync = () => {
      const has = !!getKey();
      enabled = has;
      input.placeholder = has ? 'e.g. "make the bass wobblier" (Enter to send)' : 'Add your Anthropic API key above to chat';
      status.textContent = has ? (memoryKey ? 'Key set for this page only (forgotten on reload).' : 'Key kept in this browser.') : 'No key yet.';
      $('key-clear').hidden = !has;
      refreshButtons();
    };
    $('key-save').addEventListener('click', () => {
      const k = keyInput.value.trim();
      if (!/^sk-ant-[\w-]{20,}$/.test(k)) { status.textContent = 'That does not look like an Anthropic key (it starts with sk-ant-).'; return; }
      forgetKey();
      if (remember.checked) { try { localStorage.setItem(KEY_NAME, k); } catch { memoryKey = k; } } else memoryKey = k;
      keyInput.value = '';
      sync();
    });
    $('key-clear').addEventListener('click', () => { forgetKey(); sync(); });
    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('key-save').click(); e.stopPropagation(); });
    sync();
  }

  return { open: openPanel, send };
}
