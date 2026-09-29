// The code editor: CodeMirror 6 with Strudel-aware colours, autocomplete and inline error marks.
// It exposes a small facade so the rest of the app (which grew up around a <textarea>) doesn't need to know about CodeMirror.
import { EditorState, Annotation, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, ViewPlugin } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { setDiagnostics, lintGutter } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';

const silent = Annotation.define();

// ---- mini-notation colours: inside any string, notes, numbers, rests, operators and brackets get their own colour ----
const TOKEN = /(-?\d+(?:\.\d+)?)|([a-gA-G][#b]?\d)|(~)|([*/!@?:|,%])|([[\]<>(){}])/g;
const mark = {
  num: Decoration.mark({ class: 'cm-mn-num' }), note: Decoration.mark({ class: 'cm-mn-note' }), rest: Decoration.mark({ class: 'cm-mn-rest' }),
  op: Decoration.mark({ class: 'cm-mn-op' }), br: Decoration.mark({ class: 'cm-mn-br' }),
};
export function miniTokens(text) {                      // pure and exported so it can be tested without a browser
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index;
    // a number or note glued to a word ("bd2", "hh8") is part of a sample name, not a value
    const before = text[i - 1] ?? ' ';
    if ((m[1] || m[2]) && /[A-Za-z_]/.test(before) && !m[2]) continue;
    if (m[2] && /[A-Za-z_]/.test(before)) continue;
    out.push({ from: i, to: i + m[0].length, kind: m[1] ? 'num' : m[2] ? 'note' : m[3] ? 'rest' : m[4] ? 'op' : 'br' });
  }
  return out;
}
const miniPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view); }
  build(view) {
    const b = new RangeSetBuilder();
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({ from, to, enter: (n) => {
        if (n.name !== 'String' && n.name !== 'TemplateString') return;
        const text = view.state.doc.sliceString(n.from + 1, n.to - 1);
        for (const tk of miniTokens(text)) b.add(n.from + 1 + tk.from, n.from + 1 + tk.to, mark[tk.kind]);
        return false;
      } });
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

// ---- notes lighting up while they play: app.js sends the source ranges that are sounding right now ----
const setPlaying = StateEffect.define();
const playingField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPlaying)) return Decoration.set(e.value.map(([from, to]) => Decoration.mark({ class: 'cm-playing' }).range(from, to)), true);
    return tr.docChanged ? Decoration.none : value;            // stale after an edit: positions no longer mean anything
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- the number a MIDI knob is currently driving ----
const setTarget = StateEffect.define();
const targetField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setTarget)) return e.value ? Decoration.set([Decoration.mark({ class: 'cm-knob-target' }).range(e.value[0], e.value[1])]) : Decoration.none;
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- look: follows the page's colour variables (dark and light) ----
const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '15px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--dim)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 5%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent-2) 30%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: '6px' },
  '.cm-tooltip-autocomplete ul': { fontFamily: 'var(--mono)', fontSize: '13px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#fff' },
  '.cm-completionDetail': { color: 'var(--dim)', fontStyle: 'normal', marginLeft: '.8em' },
  '.cm-knob-target': { outline: '2px solid var(--accent-2)', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--accent-2) 25%, transparent)' },
  '.cm-playing': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)', borderRadius: '3px', outline: '1px solid var(--accent)' },
  '.cm-mn-num': { color: 'var(--syn-num)' }, '.cm-mn-note': { color: 'var(--syn-note)' }, '.cm-mn-rest': { color: 'var(--dim)' },
  '.cm-mn-op': { color: 'var(--syn-op)' }, '.cm-mn-br': { color: 'var(--syn-br)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--err)', textUnderlineOffset: '3px' },
});
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: 'var(--syn-kw)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-str)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--dim)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-fn)' },
  { tag: [t.propertyName], color: 'var(--syn-prop)' },
  { tag: [t.operator, t.punctuation], color: 'var(--syn-op)' },
]);

// ---- autocomplete ----
// Names come from the live Strudel engine (every pattern method, every registered sound including your own), so the
// list is always exactly what will run. `getNames()` returns { methods: string[], globals: string[], sounds: string[] }.
const SOUND_CONTEXT = /\b(?:s|sound|bank)\s*[(:]\s*$/;
const FRIENDLY = { drums: 'kick snare hat … or a step grid', bass: 'bass line (numbers are notes of the key)', chords: 'chord names', pad: 'slow soft chords', lead: 'melody', tempo: 'set the BPM', key: 'set the key' };
export function completionSource(getNames) {
  return (context) => {
    const inner = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (inner.name === 'String' || inner.name === 'TemplateString') {
      const before = context.state.doc.sliceString(Math.max(0, inner.from - 40), inner.from);
      if (!SOUND_CONTEXT.test(before)) return null;
      const word = context.matchBefore(/[\w#:.\-]*$/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      return { from: word.from, options: getNames().sounds.map((label) => ({ label, type: 'constant' })), validFor: /^[\w#:.\-]*$/ };
    }
    if (inner.name === 'LineComment' || inner.name === 'BlockComment') return null;
    const word = context.matchBefore(/\.?[A-Za-z_$][\w$]*$|\.$/);
    if (!word || (word.text === '' && !context.explicit)) return null;
    const names = getNames();
    if (word.text.startsWith('.')) return { from: word.from + 1, options: names.methods.map((label) => ({ label, type: 'method' })), validFor: /^[\w$]*$/ };
    if (word.to - word.from < 2 && !context.explicit) return null;
    return { from: word.from, options: names.globals.map((label) => ({ label, type: 'function', detail: FRIENDLY[label] })), validFor: /^[\w$]*$/ };
  };
}

// ---- error marks: put the message on the right place when we can tell where it is ----
export function locateError(doc, message) {
  const at = String(message).match(/\((\d+):(\d+)\)/);                                   // acorn: "Unexpected token (3:10)"
  const lines = doc.split('\n');
  if (at && +at[1] >= 1 && +at[1] <= lines.length) {
    const line = +at[1];
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    return { from: start, to: start + Math.max(1, lines[line - 1].length) };
  }
  const word = String(message).match(/"([\w$]+)"|\b([\w$]+) is not (?:defined|a function)/);   // Unknown option "banana" / foo is not defined
  const name = word && (word[1] || word[2]);
  if (name) { const i = doc.search(new RegExp(`\\b${name}\\b`)); if (i >= 0) return { from: i, to: i + name.length }; }
  return null;
}

export function createEditor({ parent, doc, onChange, onRun, onStop, getNames }) {
  const listeners = new Set();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(), lintGutter(), history(), drawSelection(), highlightActiveLine(), bracketMatching(), closeBrackets(), indentOnInput(),
        javascript(), syntaxHighlighting(highlight), miniPlugin, playingField, targetField, theme,
        autocompletion({ override: [completionSource(getNames)], icons: false }),
        keymap.of([
          { key: 'Mod-Enter', preventDefault: true, run: () => { onRun(); return true; } },
          { key: 'Mod-.', preventDefault: true, run: () => { onStop(); return true; } },
          indentWithTab, ...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap,
        ]),
        EditorView.contentAttributes.of({ 'aria-label': 'Song code', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(silent))) onChange();
          if (u.docChanged || u.selectionSet) queueMicrotask(() => { for (const f of listeners) f(); });   // after this update finishes: listeners may dispatch too
        }),
      ],
    }),
  });
  const text = () => view.state.doc.toString();
  return {
    view,
    get value() { return text(); },
    // Programmatic replacement: doesn't call onChange (the caller decides what should follow, as it did with the textarea).
    setValue(code) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code }, annotations: silent.of(true) }); this.setError(null); },
    // Adds a line's worth of code at the end of the line the cursor is on (calls onChange).
    insertAtLineEnd(code) {
      const at = view.state.doc.lineAt(view.state.selection.main.head).to;
      view.dispatch({ changes: { from: at, insert: code }, selection: { anchor: at + code.length }, scrollIntoView: true });
    },
    // Adds code as a new paragraph at the end (calls onChange).
    append(code) {
      const cur = text(), body = cur.replace(/\s*$/, '');
      const insert = (body ? '\n\n' : '') + code + '\n';
      view.dispatch({ changes: { from: body.length, to: cur.length, insert }, scrollIntoView: true });
    },
    setError(message) {
      if (message == null) { view.dispatch(setDiagnostics(view.state, [])); return; }
      const span = locateError(text(), message);
      view.dispatch(setDiagnostics(view.state, span ? [{ ...span, severity: 'error', message: String(message).split('\n')[0] }] : []));
    },
    // ranges: [[from, to], ...] in editor offsets that are sounding now (empty array clears)
    highlight(ranges) {
      const n = view.state.doc.length;
      const tree = syntaxTree(view.state);
      const inString = (a, b) => { const node = tree.resolveInner(a, 1); return (node.name === 'String' || node.name === 'TemplateString') && a > node.from && b < node.to; };
      // only ranges that sit inside one string literal: anything else came from code the app generated, and would light the wrong text
      const ok = ranges.filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b <= n && a < b && inString(a, b));
      if (!ok.length && !view.state.field(playingField).size) return;     // nothing to clear
      view.dispatch({ effects: setPlaying.of(ok), annotations: silent.of(true) });
    },
    // The visual editors' hooks: where the cursor is, be told about edits and cursor moves, replace an exact range (calls onChange).
    cursor() { return view.state.selection.main.head; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    replace(from, to, text) { view.dispatch({ changes: { from, to, insert: text } }); },
    moveTo(pos) { view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) }, scrollIntoView: true }); },
    selection() { const r = view.state.selection.main; return { from: r.from, to: r.to }; },
    markTarget(range) {
      const n = view.state.doc.length;
      const ok = range && range[0] < range[1] && range[1] <= n ? range : null;
      if (!ok && !view.state.field(targetField).size) return;
      view.dispatch({ effects: setTarget.of(ok), annotations: silent.of(true) });
    },
    focus() { view.focus(); },
  };
}
