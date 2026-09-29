import test from 'node:test';
import assert from 'node:assert/strict';
import { stripLocal } from '../scripts/strip-local.mjs';

test('removes fenced blocks in any comment syntax and keeps everything else', () => {
  const js = 'a();\n// @local-start\nsecret();\n// @local-end\nb();';
  assert.equal(stripLocal(js), 'a();\nb();');
  assert.equal(stripLocal('<p>\n<!-- @local-start -->\n<b>x</b>\n<!-- @local-end -->\n</p>'), '<p>\n</p>');
  assert.equal(stripLocal('.a{}\n/* @local-start */\n.b{}\n/* @local-end */\n.c{}'), '.a{}\n.c{}');
  assert.equal(stripLocal('no fences here\n'), 'no fences here\n');
});

test('several blocks; unbalanced fences are an error, never a silent leak', () => {
  assert.equal(stripLocal('1\n// @local-start\n2\n// @local-end\n3\n// @local-start\n4\n// @local-end\n5'), '1\n3\n5');
  assert.throws(() => stripLocal('a\n// @local-start\nb'), /without @local-end/);
  assert.throws(() => stripLocal('a\n// @local-end\nb'), /without @local-start/);
});
