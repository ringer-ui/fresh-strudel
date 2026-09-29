// The workspace: a dock that holds several panels at once (resizable, collapsible, on either side), themes, and the
// resizable visuals strip. Layout is remembered in this browser. No framework: it just arranges the existing panel elements.

export const THEMES = { system: 'Match my system', dark: 'Dark', light: 'Light', contrast: 'High contrast' };

export function applyTheme(name, root = document.documentElement) {
  const t = name in THEMES && name !== 'system' ? name : null;
  if (t) root.dataset.theme = t; else delete root.dataset.theme;
  window.dispatchEvent(new Event('themechange'));                 // canvases re-read their colours
  return t ?? 'system';
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createDock({ root, store, onChange = () => {} }) {
  const panels = new Map();                                       // name -> { wrap, body, title, node }
  const read = (k, d) => { try { return JSON.parse(store.get(k, '') || 'null') ?? d; } catch { return d; } };
  const state = { open: read('dock-open', ['help']), collapsed: new Set(read('dock-collapsed', [])), width: clamp(Number(store.get('dock-width', 400)) || 400, 300, 900), side: store.get('dock-side', 'right') === 'left' ? 'left' : 'right' };
  const save = () => { store.set('dock-open', JSON.stringify(state.open)); store.set('dock-collapsed', JSON.stringify([...state.collapsed])); store.set('dock-width', String(state.width)); store.set('dock-side', state.side); };

  const handle = Object.assign(document.createElement('div'), { className: 'dock-handle', role: 'separator', tabIndex: 0, title: 'Drag to resize (arrow keys work too)' });
  handle.setAttribute('aria-orientation', 'vertical'); handle.setAttribute('aria-label', 'Resize the side panels');
  root.prepend(handle);

  function render() {
    root.style.setProperty('--dock-w', `${state.width}px`);
    root.parentElement.classList.toggle('dock-left', state.side === 'left');
    let shown = 0;
    for (const [name, p] of panels) {
      const open = state.open.includes(name), collapsed = state.collapsed.has(name);
      p.wrap.hidden = !open; p.wrap.classList.toggle('collapsed', collapsed);
      p.toggle.setAttribute('aria-expanded', String(!collapsed)); p.toggle.textContent = collapsed ? '▸' : '▾';
      if (open) shown++;
    }
    // panels appear in the order they were opened (newest at the bottom)
    for (const name of state.open) { const p = panels.get(name); if (p) root.append(p.wrap); }
    root.hidden = shown === 0;
    onChange(state.open.slice());
  }
  const set = (fn) => { fn(); save(); render(); };

  const api = {
    register(name, node, title) {
      const wrap = Object.assign(document.createElement('section'), { className: 'dock-panel' });
      wrap.dataset.panel = name;
      const head = Object.assign(document.createElement('div'), { className: 'dock-head' });
      const toggle = Object.assign(document.createElement('button'), { className: 'dock-btn', title: 'Collapse or expand' });
      toggle.setAttribute('aria-label', `Collapse ${title}`);
      const label = Object.assign(document.createElement('span'), { textContent: title });
      const close = Object.assign(document.createElement('button'), { className: 'dock-btn', textContent: '×', title: 'Close' });
      close.setAttribute('aria-label', `Close ${title}`);
      head.append(toggle, label, close);
      const body = Object.assign(document.createElement('div'), { className: 'dock-body' });
      node.hidden = false;
      body.append(node); wrap.append(head, body); root.append(wrap);
      toggle.addEventListener('click', () => set(() => { state.collapsed.has(name) ? state.collapsed.delete(name) : state.collapsed.add(name); }));
      label.addEventListener('click', () => toggle.click());
      close.addEventListener('click', () => api.close(name));
      panels.set(name, { wrap, body, title, node, toggle });
      render();
    },
    isOpen: (name) => state.open.includes(name),
    open(name) { if (!panels.has(name)) return; set(() => { if (!state.open.includes(name)) state.open.push(name); state.collapsed.delete(name); }); },
    close(name) { set(() => { state.open = state.open.filter((n) => n !== name); }); },
    toggle(name) { api.isOpen(name) ? api.close(name) : api.open(name); },
    titles: () => [...panels].map(([name, p]) => ({ name, title: p.title })),
    get side() { return state.side; },
    setSide(side) { set(() => { state.side = side === 'left' ? 'left' : 'right'; }); },
    get width() { return state.width; },
    setWidth(w) { set(() => { state.width = clamp(Math.round(w), 300, Math.min(900, Math.round(window.innerWidth * 0.7))); }); },
  };

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const move = (ev) => api.setWidth(state.side === 'left' ? ev.clientX : window.innerWidth - ev.clientX);
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('keydown', (e) => {
    const dir = (e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0) * (state.side === 'left' ? -1 : 1);
    if (dir) { e.preventDefault(); api.setWidth(state.width + dir * 24); }
  });
  render();
  return api;
}

// A drag handle that sets a CSS length variable on the document (used for the visuals strip height).
export function makeVerticalResizer({ handle, target, prop, min, max, store, key }) {
  const saved = Number(store.get(key, 0));
  if (saved) target.style.setProperty(prop, `${clamp(saved, min, max)}px`);
  const set = (h) => { const v = clamp(Math.round(h), min, max); target.style.setProperty(prop, `${v}px`); store.set(key, String(v)); };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const move = (ev) => set(target.getBoundingClientRect().bottom - ev.clientY);
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}
