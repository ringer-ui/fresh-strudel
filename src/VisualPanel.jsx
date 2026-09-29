// The visual editors: a step sequencer for drums({...}), a piano roll for simple note strings, and knobs for numbers.
// They show the track your cursor is in, and every change is an exact text edit in the code (see visual.js), so the code
// stays the single source of truth: edit either side and the other follows.
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { splitStatements, findTracks } from '../preprocess.js';
import { findDrumGrids, nextStep, withStep, addDrumRow, removeDrumRow, DRUM_ROW_NAMES, findNoteStrings, withPitch, rollRange, noteName, findControls, formatNumber, toPos, fromPos } from './visual.js';

const inside = (item, st) => item.from >= st.start && item.from <= st.end;
const BLACK = new Set([1, 3, 6, 8, 10]);

function Drums({ code, grid, edit }) {
  const first = grid.rows.find((r) => r.editable);
  const used = new Set(grid.rows.map((r) => r.name));
  return (
    <section class="vis-block">
      <h3>Drum grid</h3>
      {grid.rows.map((row, ri) => (
        <div class="vis-row" key={row.name + ri}>
          <span class="vis-label" title={row.name}>{row.name}</span>
          {row.editable ? (
            <div class="vis-steps">
              {[...row.text].map((ch, i) => (
                <button key={i} class={`vis-step s-${/[xXo]/.test(ch) ? ch : 'off'}${i % 4 === 0 ? ' beat' : ''}${i > 0 && i % 16 === 0 ? ' bar' : ''}`}
                  aria-label={`${row.name} step ${i + 1}`} aria-pressed={/[xXo]/.test(ch)} title="Click: on/off. Shift-click: accent / ghost"
                  onClick={(e) => edit({ from: row.from, to: row.to, text: withStep(row.text, i, nextStep(ch, { accent: e.shiftKey })) })} />
              ))}
            </div>
          ) : <span class="note">written as code; edit it in the editor</span>}
          <button class="vis-x" title={`Remove ${row.name}`} aria-label={`Remove ${row.name}`} onClick={() => edit(removeDrumRow(code, grid, ri))}>×</button>
        </div>
      ))}
      <select class="vis-add" value="" aria-label="Add a drum row" onChange={(e) => { if (e.target.value) edit(addDrumRow(code, grid, e.target.value, first?.text.length ?? 16)); e.target.value = ''; }}>
        <option value="">+ add a drum…</option>
        {DRUM_ROW_NAMES.filter((n) => !used.has(n)).map((n) => <option value={n}>{n}</option>)}
      </select>
    </section>
  );
}

function Roll({ item, edit }) {
  const { lo, hi } = rollRange(item);
  const rows = []; for (let p = hi; p >= lo; p--) rows.push(p);
  const label = (p) => (item.kind === 'names' ? noteName(p, item.spell) : String(p));
  const set = (i, p) => edit({ from: item.from, to: item.to, text: withPitch(item, i, item.pitches[i] === p ? null : p) });
  const resize = (words) => edit({ from: item.from, to: item.to, text: words.join(' ') });
  const n = item.words.length;
  return (
    <section class="vis-block">
      <h3>{item.fn}(…) <span class="note">{n} steps</span></h3>
      <div class="vis-tools">
        <button onClick={() => resize(item.words.slice(0, Math.max(1, n - 1)))} disabled={n <= 1} title="One step shorter">− step</button>
        <button onClick={() => resize([...item.words, '~'])} title="One step longer">+ step</button>
        <button onClick={() => resize([...item.words, ...item.words])} title="Repeat the pattern twice as long">×2</button>
      </div>
      <div class="vis-roll" role="grid" aria-label={`${item.fn} piano roll`}>
        {rows.map((p) => (
          <div class={`vis-roll-row${item.kind === 'names' && BLACK.has(((p % 12) + 12) % 12) ? ' black' : ''}${item.kind === 'names' && p % 12 === 0 ? ' c' : ''}`} key={p}>
            <span class="vis-pitch">{label(p)}</span>
            {item.pitches.map((cur, i) => (
              <button key={i} class={`vis-cell${cur === p ? ' on' : ''}${i % 4 === 0 ? ' beat' : ''}`} aria-label={`${label(p)} step ${i + 1}`} aria-pressed={cur === p} onClick={() => set(i, p)} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Knobs({ controls, edit }) {
  return (
    <section class="vis-block">
      <h3>Knobs</h3>
      {controls.map((c, i) => (
        <label class="vis-knob" key={i}>
          <span class="vis-label">{c.name}</span>
          <input type="range" min="0" max="1000" step="1" value={Math.round(toPos(c.spec, c.value) * 1000)}
            onInput={(e) => edit({ from: c.from, to: c.to, text: formatNumber(fromPos(c.spec, e.target.value / 1000), c.spec.step) })} />
          <output>{formatNumber(c.value, c.spec.step)}</output>
        </label>
      ))}
    </section>
  );
}

function Midi({ midi }) {
  const [, bump] = useState(0);
  useEffect(() => midi.subscribe(() => bump((n) => n + 1)), [midi]);
  const s = midi.state, t = s.target;
  const what = t ? `${t.name ?? (t.mini ? 'note value' : 'number')} = ${t.text ?? t.value}` : 'put the cursor on a number';
  return (
    <section class="vis-block vis-midi">
      <h3>MIDI knob</h3>
      {!s.supported ? <p class="note">This browser has no Web MIDI. Use Chrome or Edge.</p> : (
        <>
          <div class="vis-tools">
            {s.enabled ? <button onClick={() => midi.disable()}>Disconnect</button> : <button class="primary" onClick={() => midi.enable()}>Connect MIDI</button>}
            {s.enabled && <button class={s.learning ? 'primary' : ''} onClick={() => midi.learn()}>{s.learning ? 'Turn a knob…' : s.cc == null ? 'Learn a knob' : 'Re-learn'}</button>}
            {s.enabled && s.cc != null && <button onClick={() => midi.forget()} title="Forget the mapped knob">Forget</button>}
          </div>
          {s.error && <p class="note vis-err">{s.error}</p>}
          {s.enabled && <p class="note">{s.devices.length ? s.devices.join(', ') : 'No MIDI device found. Plug one in.'}</p>}
          {s.enabled && s.cc != null && (
            <>
              <p class="vis-target">Knob CC {s.cc} → <b>{what}</b></p>
              <label class="note">Knob type <select value={s.mode} onChange={(e) => midi.setMode(e.target.value)}>
                <option value="absolute">Knob (absolute)</option><option value="relative">Endless encoder (relative)</option></select></label>
              <p class="note">Click a number in the code (or select it) and turn the knob. It moves the value from where it is, so nothing jumps.</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Panel({ editor, onEdited, midi }) {
  const [, bump] = useState(0);
  useEffect(() => editor.subscribe(() => bump((n) => n + 1)), [editor]);
  const code = editor.value;
  const statements = splitStatements(code);
  const cur = editor.cursor();
  const st = statements.findLast((s) => s.start <= cur) ?? statements[0];      // the statement the cursor is in (or the last one before it)
  const tracks = findTracks(code);
  const edit = (e) => { editor.replace(e.from, e.to, e.text); onEdited(); };
  if (!st) return <p class="note">Nothing to show yet. Add a track (try Snippets), then click into it.</p>;
  const grids = findDrumGrids(code).filter((g) => inside(g, st));
  const notes = findNoteStrings(code).filter((n) => inside(n, st));
  const controls = findControls(code).filter((c) => inside(c, st));
  const here = tracks.find((t) => t.start >= st.start && t.start <= st.end);
  const editableNotes = notes.filter((n) => n.editable);
  return (
    <div class="vis">
      <Midi midi={midi} />
      <div class="vis-tabs" role="tablist">
        {tracks.map((t) => <button role="tab" aria-selected={t === here} class={t === here ? 'on' : ''} onClick={() => editor.moveTo(t.start)}>{t.name}</button>)}
      </div>
      {grids.map((g, i) => <Drums key={'d' + i} code={code} grid={g} edit={edit} />)}
      {editableNotes.map((n, i) => <Roll key={'n' + i} item={n} edit={edit} />)}
      {controls.length > 0 && <Knobs controls={controls} edit={edit} />}
      {!grids.length && !editableNotes.length && !controls.length && (
        <p class="note">Nothing here has a visual editor yet. Click into a track that uses <code>drums({'{…}'})</code>, a simple <code>bass("0 ~ 3 ~")</code> or <code>lead("c4 e4 g4")</code>, or numbers like <code>.lpf(400)</code> or <code>{'{ vol: .5 }'}</code>.</p>
      )}
      {notes.length > editableNotes.length && <p class="note">Some note strings use brackets, repeats or mixed names, so they stay as code.</p>}
    </div>
  );
}

export function mountVisual(root, props) { render(<Panel {...props} />, root); }
