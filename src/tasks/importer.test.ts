import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTasksFromSpecText } from './importer.ts';

test('parseTasksFromSpecText reads PRD-style JSON payloads', () => {
  const preview = parseTasksFromSpecText(JSON.stringify({
    userStories: [
      {
        id: 'US-001',
        title: 'ログイン画面を追加する',
        acceptanceCriteria: ['メールアドレスでログインできる', '失敗時にエラーを出す'],
        notes: '認証APIと接続する',
      },
      {
        title: '通知設定を保存する',
        description: 'ユーザーごとに設定を保持する',
      },
    ],
  }));

  assert.equal(preview.format, 'json');
  assert.equal(preview.tasks.length, 2);
  assert.equal(preview.tasks[0]?.title, 'ログイン画面を追加する');
  assert.equal(preview.tasks[0]?.summary, '認証APIと接続する');
  assert.deepEqual(preview.tasks[0]?.acceptanceCriteria, [
    'メールアドレスでログインできる',
    '失敗時にエラーを出す',
  ]);
  assert.equal(preview.tasks[1]?.title, '通知設定を保存する');
  assert.equal(preview.tasks[1]?.summary, 'ユーザーごとに設定を保持する');
});

test('parseTasksFromSpecText extracts top-level list items and nested acceptance criteria', () => {
  const preview = parseTasksFromSpecText(`
## 認証
- ログインAPIを追加する
  - メールアドレスとパスワードで認証できる
  - 失敗時に 401 を返す
- セッションを保持する
  JWT の有効期限を更新する
  - 失効済みトークンを拒否する
`);

  assert.equal(preview.format, 'list');
  assert.equal(preview.tasks.length, 2);
  assert.equal(preview.tasks[0]?.title, 'ログインAPIを追加する');
  assert.equal(preview.tasks[0]?.summary, '認証');
  assert.deepEqual(preview.tasks[0]?.acceptanceCriteria, [
    'メールアドレスとパスワードで認証できる',
    '失敗時に 401 を返す',
  ]);
  assert.equal(preview.tasks[1]?.title, 'セッションを保持する');
  assert.equal(preview.tasks[1]?.summary, '認証 JWT の有効期限を更新する');
  assert.deepEqual(preview.tasks[1]?.acceptanceCriteria, ['失効済みトークンを拒否する']);
});

test('parseTasksFromSpecText supports checklists, inline descriptions, and dedupes duplicate titles', () => {
  const preview = parseTasksFromSpecText(`
# リリース前チェック
1. [ ] 本番ENVを整える - 秘密情報を再確認する
2. [ ] 本番ENVを整える - 重複しても1件にまとめる
3. [x] 監視アラートを確認する - PagerDuty のルーティングを見直す
`);

  assert.equal(preview.format, 'list');
  assert.equal(preview.tasks.length, 2);
  assert.equal(preview.tasks[0]?.title, '本番ENVを整える');
  assert.equal(preview.tasks[0]?.summary, '秘密情報を再確認する');
  assert.equal(preview.tasks[1]?.title, '監視アラートを確認する');
  assert.equal(preview.tasks[1]?.summary, 'PagerDuty のルーティングを見直す');
});

test('parseTasksFromSpecText falls back to headings when no lists are present', () => {
  const preview = parseTasksFromSpecText(`
# Ralph Loop v1.1

## Panel を整理する
Task とメモの導線を分けずに、送信口をひとつに寄せる。

## Demo モードを整える
README からすぐ試せる構成にする。
`);

  assert.equal(preview.format, 'headings');
  assert.equal(preview.tasks.length, 2);
  assert.equal(preview.tasks[0]?.title, 'Panel を整理する');
  assert.equal(preview.tasks[0]?.summary, 'Task とメモの導線を分けずに、送信口をひとつに寄せる。');
  assert.equal(preview.tasks[1]?.title, 'Demo モードを整える');
});
