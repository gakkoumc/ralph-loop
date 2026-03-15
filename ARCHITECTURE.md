# Architecture

## 方針

常用できる趣味ツールとして、少ない仕組みで Codex 運用を安定させることを優先しています。

- 1 repo / 1 supervisor run を中心に据えつつ、panel では Task レーンを multi-agent 的に可視化
- file based state
- 回答待ちがあっても止めない
- Web と Discord は同じ action layer を使う
- UI 層に状態遷移を埋め込まない
- Task 量から `MaxIntegration` を決める
- 1 run では原則 1 Task を完了させ、次のTaskは次回 run で進める
- 初回は空の Task board から始め、サンプルデータは自動で読み込まない

## レイヤ

### `src/state`

`FileStateStore` が JSON / JSONL / テキストを読み書きします。

- `status.json`
- `questions.json`
- `answers.json`
- `manual-notes.json`
- `blockers.json`
- `tasks.json`
- `settings.json`
- `answer-inbox.jsonl`
- `note-inbox.txt`
- `events.jsonl`
- `agent-output.log`

### `src/actions`

運用ロジックの中心です。

- `getStatus`
- `getDashboardData`
- `pauseRun`
- `resumeRun`
- `abortRun`
- `submitAnswer`
- `enqueueManualNote`
- `createTask`
- `updateTask`
- `completeTask`
- `reopenTask`
- `listPendingQuestions`
- `listAnsweredQuestions`
- `preparePromptForNextTurn`
- `handleAgentOutput`
- `recordTaskSignal`
- `recordThinking`
- `updateRuntimeSettings`
- `requestRunStart`
- `recoverInterruptedRun`

Web と Discord はここだけを呼びます。

### `src/orchestration`

Task board と lane view を導出します。

- `MaxIntegration` を task 数から導出
- 現在 / 待機 / 完了 の Task board を構築
- supervisor / planner / worker / integrator の lane snapshot を作る
- `Thinking Stream` 用の frame を返す

### `src/parser`

Codex 出力から `[[STATUS]]`, `[[THINKING]]`, `[[TASK]]` などの structured marker を抽出します。

### `src/prompt`

未注入の answer / note と orchestration snapshot を prompt 末尾へ差し込みます。

### `src/supervisor`

反復実行を管理します。

- queued state を監視する watcher を持つ
- pause / resume / abort を監視
- prompt を組み立てて agent を起動
- output を log に保存
- marker を action layer に流す
- question 未回答でも loop を継続

実行自体は依然として 1 child command を turn ごとに扱います。multi-agent は panel / prompt / task board 側の orchestration model です。
常駐 service は queued run を state から拾って実行します。

### `src/panel`

軽量 HTTP サーバーです。

- orchestration dashboard 表示
- agent constellation 表示
- Task board 表示
- 現在のTask / 次のTask 表示
- Task の作成 / 編集 / 完了 / 差し戻し
- 初回ガイド表示
- runtime settings 編集
- start run
- answer
- note injection
- pause / resume / abort
- Basic 認証

### `src/discord`

軽量な gateway bot です。

- 通知送信
- `/status` などの message command 受信
- slash command 登録と受信
- `/start`, `/config`, `/set-*`, `/task-*`, `/tasks` command 受信
- answer / note / control を action layer に委譲
- allowlist による利用者制限

## prompt injection の流れ

1. question は回答待ちとして保存
2. answer は `answers.json` に保存
3. 次ターン開始前に未注入 answer / note を収集
4. prompt 末尾へ自然文で差し込み
5. `injectedAt` を付けて再注入を防止

## local fallback

Discord なしでも以下で回ります。

- Web panel から操作
- `state/answer-inbox.jsonl` に回答追記
- `state/note-inbox.txt` に note 追記
- `./ralph demo` で一連の流れを確認
