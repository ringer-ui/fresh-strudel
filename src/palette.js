// Command palette: Cmd/Ctrl+K, type, Enter. Also the quickest way to talk to Claude: whatever you type can be sent to the chat.
export function fuzzyScore(query, text) {                       // higher is better; -1 = no match. Word starts and runs of letters score more.
  const q = query.toLowerCase().trim(), t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at >= 0) return 100 - at + (at === 0 || t[at - 1] === ' ' ? 20 : 0) - t.length * 0.1;
  let ti = 0, score = 0, streak = 0;
  for (const c of q) {
    if (c === ' ') continue;
    const j = t.indexOf(c, ti);
    if (j < 0) return -1;
    streak = j === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (j === 0 || t[j - 1] === ' ' ? 3 : 0);
    ti = j + 1;
  }
  return score - t.length * 0.05;
}
export function rank(commands, query, limit = 12) {
  return commands.map((c) => ({ c, s: Math.max(fuzzyScore(query, c.title), fuzzyScore(query, c.keywords ?? '') - 5) })).filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.c);
}

export function createPalette({ getCommands, onAsk }) {
  let box = null, prev = null;
  function close() { if (!box) return; box.remove(); box = null; prev?.focus?.(); prev = null; }
  function open() {
    if (box) { box.querySelector('input').focus(); return; }
    prev = document.activeElement;
    box = document.createElement('div'); box.className = 'palette-overlay';
    box.innerHTML = '<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette"><input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Type a command, or ask Claude something…" autocomplete="off" spellcheck="false"><ul id="palette-list" role="listbox"></ul><div class="palette-foot"><span>↑↓ choose · Enter run · Esc close</span></div></div>';
    document.body.append(box);
    const input = box.querySelector('input'), list = box.querySelector('ul');
    let items = [], sel = 0;
    const draw = () => {
      const q = input.value;
      items = rank(getCommands(), q);
      if (q.trim() && onAsk) items.push({ title: `Ask Claude: ${q.trim()}`, hint: 'chat', run: () => onAsk(q.trim()) });
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.replaceChildren(...items.map((c, i) => {
        const li = document.createElement('li'); li.role = 'option'; li.id = `pal-${i}`; li.setAttribute('aria-selected', String(i === sel));
        const t = document.createElement('span'); t.textContent = c.title; li.append(t);
        if (c.hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = c.hint; li.append(h); }
        li.addEventListener('mousedown', (e) => { e.preventDefault(); run(c); });
        return li;
      }));
      input.setAttribute('aria-activedescendant', items.length ? `pal-${sel}` : '');
      list.children[sel]?.scrollIntoView({ block: 'nearest' });
    };
    const run = (c) => { close(); try { c.run(); } catch (e) { console.warn('command failed', e); } };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) run(items[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    draw(); input.focus();
  }
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); box ? close() : open(); }
  }, true);
  return { open, close };
}
