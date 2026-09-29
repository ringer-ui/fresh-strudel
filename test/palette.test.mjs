import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, rank } from '../src/palette.js';

const cmds = ['Play', 'Stop', 'Open Chat panel', 'Open History panel', 'Theme: High contrast', 'Scene: drop', 'Restore v3', 'Library: search'].map((title) => ({ title }));

test('fuzzy matching ranks word starts and exact runs first, and rejects non-matches', () => {
  assert.equal(fuzzyScore('zzz', 'Play'), -1);
  assert.ok(fuzzyScore('pl', 'Play') > fuzzyScore('pl', 'Open History panel'));
  assert.equal(rank(cmds, 'hist')[0].title, 'Open History panel');                 // the contiguous match beats a scattered one
  assert.equal(rank(cmds, 'thc')[0].title, 'Theme: High contrast');                // letters in order across words
  assert.equal(rank(cmds, '').length, 8);
  assert.equal(rank(cmds, 'p', 3).length, 3);
});

test('keywords help without outranking the title', () => {
  const c = [{ title: 'Toggle dock side', keywords: 'move panels left right' }, { title: 'Left handed mode' }];
  assert.equal(rank(c, 'left')[0].title, 'Left handed mode');
});
