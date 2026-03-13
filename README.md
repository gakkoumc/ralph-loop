# RalphLoop

Codex を外側から監督しつつ、`ralph` を主コマンドとして扱う orchestration-first な RalphLoop です。

このリポジトリの目的は、`ralph.sh` ベースの最小 loop を、task board / agent lanes / MaxIntegration を持つ運用ツールへ置き換えることです。

- `ralph` を主コマンドとして `start / run / start-run / configure / panel / supervisor / discord / demo / status` を扱える
- `prd.json` の task 量から `MaxIntegration` を自動決定する
- panel は単なる status 画面ではなく、agent constellation と task board を可視化する
- `Thinking Stream` は同じ行でテキストが切り替わるモーションになり、同文の待機メッセージを積まない
- サイトと Discord から run の開始、task / prompt / maxIterations / idleSeconds の更新ができる
- 質問が未回答でも停止せず、進められる作業を継続する
- 回答や手動メモは次ターン prompt 末尾へ一度だけ注入する
- Web panel と Discord bridge は同じ state / action layer を共有する
- state / log は JSON / JSONL / フラットファイルのみで扱う

## 最短起動

前提:
- Node.js 24 以上
- Codex CLI を使う場合は `codex` コマンドが通ること

```bash
./ralph demo
```

これで以下を確認できます。

- `http://127.0.0.1:8787` に orchestration panel が立つ
- demo agent が `[[QUESTION]]` を出す
- panel から回答すると次ターン prompt に注入される
- demo agent が `[[DONE]]` を返して完了する

## 通常起動

必要なら `.env` または shell env で設定を与えます。

```bash
./ralph
```

`./ralph` は always-on service として以下を同時に起動します。

- orchestration panel
- supervisor
- Discord bridge

この時点では run は自動開始しません。Web / Discord / `./ralph run` から明示的に開始します。

Discord token が未設定なら Discord bridge は自動で無効化され、Web only モードで起動します。

## 主要コマンド

```bash
./ralph
./ralph start
./ralph run "repo-wide rebuild"
./ralph start-run "repo-wide rebuild"
./ralph configure --max-iterations 40 --idle-seconds 3
./ralph panel
./ralph supervisor
./ralph discord
./ralph demo
./ralph status
npm run dev
npm run build
npm run lint
npm run test
```

補足:
- `npm run dev` と `npm run app:start` は `ralph start` の thin wrapper です
- `./ralph run` は service 起動と同時に run を 1 回キックします
- `./ralph start-run` は既に常駐している service に対して queued run を置く用途です
- `./ralph configure` は runtime settings だけを更新して終了します
- 依存パッケージは使っていないため、通常は `npm install` 不要です
- TypeScript は Node 24 の `--experimental-strip-types` で直接実行しています

## Web panel でできること

1 画面で以下を扱えます。

- run status / lifecycle / iteration
- `MaxIntegration`
- task board
- agent constellation
- `Thinking Stream`
- runtime control
- start failure / settings save の flash feedback
- pending question 一覧
- answered question 一覧
- blocker 一覧
- prompt injection queue
- recent events
- agent output tail
- `Refresh`
- `Pause`
- `Resume`
- `Abort`
- question への answer 入力
- 次ターン用の手動 note 注入

## Discord bridge

Discord token を入れると、gateway bot として動作します。

通知:
- 実行開始
- `[[STATUS]]`
- `[[QUESTION]]`
- `[[BLOCKER]]`
- `[[DONE]]`

操作:
- `/start`
- `/status`
- `/config`
- `/pause`
- `/resume`
- `/abort`
- `/answer Q-001 staging を優先してください`
- `/note 次ターンは panel 完成を優先`
- `/set-task repo-wide rebuild`
- `/set-iterations 40`
- `/set-idle 3`
- `/set-mode command`
- `/set-agent codex exec --full-auto --skip-git-repo-check`
- `/set-prompt-file /abs/path/to/prompt.md`
- `/set-prompt ここに prompt override を書く`
- `/clear-prompt`

優先通知先:
- `RALPH_DISCORD_DM_USER_ID` があれば DM
- 未設定なら `RALPH_DISCORD_NOTIFY_CHANNEL_ID`

重要:
- 現状の Discord 操作は「登録済み slash command」ではなく、`/status` 形式の message command です
- temporary tool としての MVP を優先し、重い依存を避けています

## 回答待ちでも止めないポリシー

この実装の重要な運用ルールです。

1. agent が `[[QUESTION]]` を出しても supervisor は停止しません
2. 質問は `state/questions.json` に pending として保存されます
3. Web / Discord / ローカルファイルから回答できます
4. 回答は `state/answers.json` に保存されます
5. 次ターン prompt の末尾に以下形式で一度だけ注入されます

```text
先ほどの質問の答えが届きました:
- Q-001: staging を優先してください
```

手動 note も同様に一度だけ注入されます。

```text
追加の運用メモが届きました:
- N-001: まず panel を仕上げてください
```

## Structured markers

agent 出力から以下を検出します。

```text
[[STATUS]] ...
[[THINKING]] ...
[[QUESTION]] ...
[[BLOCKER]] ...
[[TASK]] <task-id> | <pending|blocked|completed> | <task title>
[[DONE]] ...
```

処理内容:
- `STATUS`: 現在状態更新 + log 追記
- `THINKING`: `Thinking Stream` を更新
- `QUESTION`: pending question 登録 + 通知 + Web 表示
- `BLOCKER`: blocker 登録 + 通知 + Web 表示
- `TASK`: task board 更新
- `DONE`: run 完了更新

マーカー parser には unit test があります。

## state / log ファイル

デフォルトでは以下を使います。

```text
state/status.json
state/questions.json
state/answers.json
state/manual-notes.json
state/blockers.json
state/tasks.json
state/settings.json
state/answer-inbox.jsonl
state/note-inbox.txt
logs/events.jsonl
logs/agent-output.log
```

ローカルファイル fallback:

- `state/answer-inbox.jsonl`

```json
{"questionId":"Q-001","answer":"staging を優先してください"}
```

- `state/note-inbox.txt`

```text
テストより先に panel の確認を優先してください
```

supervisor / panel / actions はこれらの inbox を読み込み、同じ state に反映します。

常駐 service が `start-run` / Web / Discord の start request を拾うため、別プロセスから queued run を置く運用もできます。

## 環境変数

主な設定は `.env` または shell env で与えます。

- `RALPH_AGENT_COMMAND`
- `RALPH_AGENT_MODE`
- `RALPH_PROMPT_FILE`
- `RALPH_TASK_CATALOG_FILE`
- `RALPH_STATE_DIR`
- `RALPH_LOG_DIR`
- `RALPH_MAX_ITERATIONS`
- `RALPH_IDLE_SECONDS`
- `RALPH_PANEL_HOST`
- `RALPH_PANEL_PORT`
- `RALPH_TASK_NAME`
- `RALPH_DISCORD_TOKEN`
- `RALPH_DISCORD_NOTIFY_CHANNEL_ID`
- `RALPH_DISCORD_DM_USER_ID`
- `RALPH_DISCORD_APP_NAME`

## 構成

```text
src/actions      共通 action layer
src/cli          起動エントリ
src/demo         demo agent
src/discord      Discord bridge
src/panel        Web panel
src/orchestration MaxIntegration / lane derivation
src/parser       structured marker parser
src/prompt       prompt composition
src/state        JSON / JSONL state store
src/tasks        PRD task loader
src/supervisor   run supervisor
```

詳細は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

## legacy ファイル

以下は旧 minimal 版の資産として残しています。

- [ralph.sh](./ralph.sh)
- [dashboard.py](./dashboard.py)
- [prompt.md](./prompt.md)

新しい導線は TypeScript 実装です。legacy は移行理由を追えるよう残しているだけで、主運用対象ではありません。

## 検証済み

以下を実行して確認しています。

```bash
npm run test
npm run lint
npm run build
```

加えて、demo mode を同一 PowerShell セッションで起動し、以下を確認しました。

- question 発生
- Web API 経由の answer 投入
- prompt injection
- `DONE` による完了

## 制約

- panel 上の multi-agent は orchestration 可視化モデルであり、child process 実行自体は依然として 1 turn / 1 command が基本です
- 認証なしの internal / localhost 前提 panel
- Discord は message command ベースで、正式な slash command 登録までは未実装
- state 書き込みは temporary tool 優先でシンプル実装です
