# RalphLoop

Codex を外側から監督しつつ、`ralph` を主コマンドとして扱う、Task中心の orchestration-first RalphLoop です。

このリポジトリの目的は、`ralph.sh` ベースの最小 loop を、Task board / agent lanes / MaxIntegration を持つ運用ツールへ置き換えることです。

## 使い方（クイックスタート）

```bash
./ralph demo
```

## 使い方解説

### 1. 事前準備

1. `ralph-loop/prd.json` に実行したいストーリーを用意
2. `ralph-loop/prompt.md` にエージェントへ渡す指示を記載
3. エージェントCLI（例: Codex CLI）がこの環境で実行できる状態にする

### 2. ループ実行

```bash
./ralph-loop/ralph.sh "codex exec --full-auto" 20
```

- 第1引数: エージェント実行コマンド
- 第2引数: 最大反復回数（省略時は `MAX_ITERATIONS` か既定値 `10`）

### 3. 実行中に確認するもの

- CLI上の進捗表示（完了数/残数/次ストーリー）
- `status.json`（機械可読ステータス）
- `events.log`（通知イベント）
- `questions.log`（AIからの質問）

### 4. AIから質問が来たとき

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

- ループは停止せず継続
- 質問は `questions.log` と `events.log` に記録
- 人間は `answers.txt` へ回答を追記（またはWebパネルで送信）
- 回答は次回プロンプトへ自動注入

### 5. よく使う環境変数

```bash
MAX_ITERATIONS=20 \
SLEEP_SECONDS=1 \
SHOW_PROGRESS_LINES=8 \
AI_OUTPUT_PREFIX="🤖 AI> " \
./ralph-loop/ralph.sh "codex exec --full-auto"
```

- `MAX_ITERATIONS`（既定: `10`）
- `SLEEP_SECONDS`（既定: `2`）
- `SHOW_PROGRESS_LINES`（既定: `5`）
- `AI_OUTPUT_PREFIX`（既定: `🤖 AI> `）
- `DISCORD_WEBHOOK_URL`（任意）
- `STATUS_FILE`（既定: `status.json`）
- `ANSWER_FILE`（既定: `answers.txt`）
- `EVENT_LOG_FILE`（既定: `events.log`）

## Webパネル

```bash
python3 ./ralph-loop/dashboard.py
# http://localhost:8787
```

Webパネルでは以下ができます。

- 現在状態の確認
- `progress.txt` / `questions.log` / `events.log` の末尾確認
- `answers.txt` への回答追記

## Discord通知（任意）

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
./ralph-loop/ralph.sh "codex exec --full-auto" 20
```

Discordを使わない場合でも、同等の通知は `events.log` に保存され、Webパネルから確認できます。
