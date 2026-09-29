// History and scenes: named scenes you can switch between, every saved version of the song with a diff, restore, and an A/B
// switch you can hear. It also shows exactly what Claude is told about the session ("What Claude sees").
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { unifiedDiff, describeChange, ago, sourceWords } from './session.js';

function Diff({ a, b }) {
  const text = unifiedDiff(a, b, { context: 1, maxLines: 60 });
  if (!text) return <p class="note">Same code.</p>;
  return <pre class="hist-diff">{text.split('\n').map((l, i) => <div key={i} class={l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : ''}>{l}</div>)}</pre>;
}

function Panel({ session, apply, current, digest }) {
  const [, bump] = useState(0);
  useEffect(() => session.subscribe(() => bump((n) => n + 1)), [session]);
  const [sceneName, setSceneName] = useState('');
  const [open, setOpen] = useState(null);                                  // version id whose diff is showing
  const [ab, setAb] = useState({ a: null, b: null, base: null, on: null });
  const [showCtx, setShowCtx] = useState(false);
  const now = Date.now(), cur = current();
  const versions = [...session.versions].reverse();
  const label = (v) => `${v.name ?? `v${v.id}`} · ${sourceWords(v.source)}${v.label && v.label !== v.name ? `: ${v.label}` : ''} · ${ago(now - v.t)} ago`;

  const hear = (which) => {                                                // A/B: swap the song live, keeping a copy of where you were
    const v = session.version(ab[which]); if (!v) return;
    if (ab.base == null) { const base = session.snapshot({ code: cur.code, settings: cur.settings, source: 'typing', label: 'before A/B' }); setAb((s) => ({ ...s, base: base.id, on: which })); }
    else setAb((s) => ({ ...s, on: which }));
    apply(v, 'restore', { quiet: true });
  };
  const back = () => { const v = session.version(ab.base); if (v) apply(v, 'restore', { quiet: true }); setAb({ a: ab.a, b: ab.b, base: null, on: null }); };
  const pick = (which, id) => setAb((s) => ({ ...s, [which]: id ? Number(id) : null }));
  const options = (
    <>
      <option value="">—</option>
      {session.scenes.map((v) => <option value={v.id} key={'s' + v.id}>scene: {v.name}</option>)}
      {versions.map((v) => <option value={v.id} key={v.id}>{label(v)}</option>)}
    </>
  );
  const A = session.version(ab.a), B = session.version(ab.b);

  return (
    <div class="hist">
      <section class="vis-block">
        <h3>Scenes</h3>
        <div class="hist-scenes">
          {session.scenes.length === 0 && <p class="note">Save the song as a scene to jump back to it later (a verse, a drop, an idea).</p>}
          {session.scenes.map((v) => (
            <span class="hist-scene" key={v.id}>
              <button onClick={() => apply(v, 'scene')} title={`Switch to "${v.name}" (${ago(now - v.t)} ago). Your current song is kept in the history first.`}>{v.name}</button>
              <button class="vis-x" aria-label={`Delete scene ${v.name}`} onClick={() => session.deleteScene(v.id)}>×</button>
            </span>
          ))}
        </div>
        <form class="hist-save" onSubmit={(e) => { e.preventDefault(); session.saveScene({ ...cur, name: sceneName }); setSceneName(''); }}>
          <input value={sceneName} onInput={(e) => setSceneName(e.target.value)} placeholder="Scene name (e.g. drop)" maxLength="40" aria-label="Scene name" />
          <button type="submit">Save scene</button>
        </form>
      </section>

      <section class="vis-block">
        <h3>A / B</h3>
        <div class="hist-ab">
          <label>A <select value={ab.a ?? ''} onChange={(e) => pick('a', e.target.value)}>{options}</select></label>
          <label>B <select value={ab.b ?? ''} onChange={(e) => pick('b', e.target.value)}>{options}</select></label>
        </div>
        <div class="vis-tools">
          <button class={ab.on === 'a' ? 'primary' : ''} disabled={!A} onClick={() => hear('a')}>Hear A</button>
          <button class={ab.on === 'b' ? 'primary' : ''} disabled={!B} onClick={() => hear('b')}>Hear B</button>
          {ab.base != null && <button onClick={back} title="Go back to the song you had before comparing">Back to mine</button>}
        </div>
        {A && B && <><p class="note">{describeChange(A.code, B.code)}</p><Diff a={A.code} b={B.code} /></>}
      </section>

      <section class="vis-block">
        <h3>Versions <span class="note">{versions.length}</span></h3>
        {versions.length === 0 && <p class="note">Versions appear when you press Play, when Claude changes the song, and when you pause for a moment.</p>}
        <ol class="hist-list">
          {versions.map((v, i) => {
            const prev = session.versions[session.versions.indexOf(v) - 1];
            return (
              <li key={v.id} class={v.source === 'claude' ? 'by-claude' : ''}>
                <div class="hist-line">
                  <button class="hist-title" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>
                    <b>v{v.id}</b> {sourceWords(v.source)}{v.label ? `: ${v.label}` : ''} <span class="note">{ago(now - v.t)} ago</span>
                  </button>
                  <button onClick={() => apply(v, 'restore')} title="Bring this version back (your current song is kept in the history first)">Restore</button>
                </div>
                {v.sources?.length > 0 && <div class="note">Inspired by {v.sources.map((s, k) => (<span key={k}>{k ? '; ' : ''}{/^https?:\/\//.test(s.url ?? '') ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}{s.author ? ` by ${s.author}` : ''} ({s.license || 'licence unknown'})</span>))}</div>}
                {open === v.id && <><p class="note">{prev ? `Compared with v${prev.id}: ${describeChange(prev.code, v.code)}` : 'The first saved version.'}</p>{prev ? <Diff a={prev.code} b={v.code} /> : <pre class="hist-diff">{v.code}</pre>}</>}
              </li>
            );
          })}
        </ol>
      </section>

      <section class="vis-block">
        <h3>What Claude sees</h3>
        <p class="note">With each chat message Claude also gets this summary of the session, so it knows what you changed by hand and what it already tried.</p>
        <button onClick={() => setShowCtx(!showCtx)}>{showCtx ? 'Hide' : 'Show'}</button>
        {showCtx && <pre class="hist-ctx">{digest()}</pre>}
        <p class="note"><button onClick={() => { if (confirm('Clear all saved versions, scenes and activity?')) session.clear(); }}>Clear history</button></p>
      </section>
    </div>
  );
}

export function mountHistory(root, props) { render(<Panel {...props} />, root); }
