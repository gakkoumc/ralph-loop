import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStructuredMarkers } from './markers.ts';

test('parseStructuredMarkers parses inline markers in order', () => {
  const output = `
noise
[[STATUS]] 実装を開始しました
[[QUESTION]] staging と production のどちらを優先しますか？
[[BLOCKER]] 秘密情報が未設定です
[[DONE]] 実装完了
`.trim();

  assert.deepEqual(parseStructuredMarkers(output), [
    {
      kind: 'STATUS',
      content: '実装を開始しました',
      raw: '[[STATUS]] 実装を開始しました',
      lineStart: 2,
      lineEnd: 2,
    },
    {
      kind: 'QUESTION',
      content: 'staging と production のどちらを優先しますか？',
      raw: '[[QUESTION]] staging と production のどちらを優先しますか？',
      lineStart: 3,
      lineEnd: 3,
    },
    {
      kind: 'BLOCKER',
      content: '秘密情報が未設定です',
      raw: '[[BLOCKER]] 秘密情報が未設定です',
      lineStart: 4,
      lineEnd: 4,
    },
    {
      kind: 'DONE',
      content: '実装完了',
      raw: '[[DONE]] 実装完了',
      lineStart: 5,
      lineEnd: 5,
    },
  ]);
});

test('parseStructuredMarkers keeps multiline bodies until the next marker', () => {
  const output = `
[[QUESTION]] API キーが必要です
未設定なら mock で続行します
[[STATUS]] 回答待ちの間も panel 実装を続行します
追加の詳細
`.trim();

  assert.deepEqual(parseStructuredMarkers(output), [
    {
      kind: 'QUESTION',
      content: 'API キーが必要です\n未設定なら mock で続行します',
      raw: '[[QUESTION]] API キーが必要です\n未設定なら mock で続行します',
      lineStart: 1,
      lineEnd: 2,
    },
    {
      kind: 'STATUS',
      content: '回答待ちの間も panel 実装を続行します\n追加の詳細',
      raw: '[[STATUS]] 回答待ちの間も panel 実装を続行します\n追加の詳細',
      lineStart: 3,
      lineEnd: 4,
    },
  ]);
});

test('parseStructuredMarkers supports THINKING and TASK markers', () => {
  const output = `
[[THINKING]] task graph を再配線しています
[[TASK]] US-001 | completed | Rust project init
`.trim();

  assert.deepEqual(parseStructuredMarkers(output), [
    {
      kind: 'THINKING',
      content: 'task graph を再配線しています',
      raw: '[[THINKING]] task graph を再配線しています',
      lineStart: 1,
      lineEnd: 1,
    },
    {
      kind: 'TASK',
      content: 'US-001 | completed | Rust project init',
      raw: '[[TASK]] US-001 | completed | Rust project init',
      lineStart: 2,
      lineEnd: 2,
    },
  ]);
});
