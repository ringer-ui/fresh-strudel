import test from 'node:test';
import assert from 'node:assert/strict';
import { miniTokens, locateError } from '../src/editor.js';

const kinds = (s) => miniTokens(s).map((t) => `${t.kind}:${s.slice(t.from, t.to)}`);

test('mini-notation tokens: numbers, notes, rests, operators, brackets', () => {
  assert.deepEqual(kinds('0 ~ c3 [e3 g3]*2'), ['num:0', 'rest:~', 'note:c3', 'br:[', 'note:e3', 'note:g3', 'br:]', 'op:*', 'num:2']);
  assert.deepEqual(kinds('<Cm7 Fm7>'), ['br:<', 'br:>']);          // chord names and sample names keep the plain string colour
});

test('digits glued to a sample name are part of the name, not a value', () => {
  assert.deepEqual(kinds('bd2 hh8 rolandtr909_bd:3'), ['op::', 'num:3']);
});

test('error location: line/column from a syntax error, or the offending name', () => {
  const doc = 'bass("0")\nlead("1", { banana: 2 })\n';
  assert.deepEqual(locateError(doc, 'Unexpected token (2:5)'), { from: 10, to: 10 + 'lead("1", { banana: 2 })'.length });
  assert.deepEqual(locateError(doc, 'Unknown option "banana". Try vol'), { from: doc.indexOf('banana'), to: doc.indexOf('banana') + 6 });
  assert.deepEqual(locateError(doc, 'foo is not defined'), null);
  assert.equal(locateError(doc, 'Unexpected token (99:1)'), null);
});
