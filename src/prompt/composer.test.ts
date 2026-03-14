import test from 'node:test';
import assert from 'node:assert/strict';

import { composePromptWithInjections } from './composer.ts';

test('composePromptWithInjections appends answers and manual notes once', () => {
  const result = composePromptWithInjections(
    'base prompt',
    [
      {
        id: 'A-001',
        questionId: 'Q-001',
        answer: 'staging を優先してください',
        createdAt: '2026-03-13T00:00:00.000Z',
        source: 'web',
      },
    ],
    [
      {
        id: 'N-001',
        note: 'デプロイより panel 完成を優先してください',
        createdAt: '2026-03-13T00:00:00.000Z',
        source: 'web',
      },
    ],
  );

  assert.equal(
    result.prompt,
    [
      'base prompt',
      '',
      '---',
      '先ほどの質問の答えが届きました:',
      '- Q-001: staging を優先してください',
      '',
      '追加の運用メモが届きました:',
      '- N-001: デプロイより panel 完成を優先してください',
      '',
    ].join('\n'),
  );
  assert.deepEqual(result.injectedAnswerIds, ['A-001']);
  assert.deepEqual(result.injectedNoteIds, ['N-001']);
});

test('composePromptWithInjections leaves prompt unchanged when queue is empty', () => {
  const result = composePromptWithInjections('base prompt', [], []);

  assert.equal(result.prompt, 'base prompt');
  assert.deepEqual(result.injectedAnswerIds, []);
  assert.deepEqual(result.injectedNoteIds, []);
});

test('composePromptWithInjections prepends orchestration context when provided', () => {
  const result = composePromptWithInjections('base prompt', [], [], ['現在の orchestration snapshot:']);

  assert.equal(result.prompt, ['base prompt', '', '---', '現在の orchestration snapshot:', ''].join('\n'));
});
