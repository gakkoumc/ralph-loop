# Ralph Loop（暫定運用向け）

LuLOS を作るまでの一時運用でも使いやすいように、Ralph を **止めずに回し続ける** ための補助機能を入れています。

- CLIで進捗が見える
- AIの発話が明確に見分けられる
- Discordに通知を送れる（任意）
- Webパネルだけでも同等の通知ログ確認＆回答入力ができる
- AIから質問が出ても、回答待ちで停止せず継続する

## 1) 使い方（基本）

```bash
chmod +x ./ralph-loop/ralph.sh
./ralph-loop/ralph.sh "codex exec --full-auto" 20
```

## 2) 進捗の見え方（CLI）

- `📋 ストーリー進捗`: `prd.json` から完了/残り/次ストーリーを表示
- `📝 最新メモ`: `progress.txt` の末尾を表示
- AI出力は行頭に `🤖 AI> ` を付与（`AI_OUTPUT_PREFIX` で変更可能）

## 3) Discord通知（任意）

`DISCORD_WEBHOOK_URL` を設定すると通知します。未設定でも `events.log` に同じ通知内容を保存し、Webパネルで確認できます。

- Ralph開始
- AIの質問検知（`<question> ... </question>`）
- Ralph完了 / 最大反復到達

※ 上記はDiscord未使用時でも `events.log` へ記録されます。

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
./ralph-loop/ralph.sh "codex exec --full-auto" 20
```

## 4) Webパネル（更新ボタン付き）

```bash
python3 ./ralph-loop/dashboard.py
# -> http://localhost:8787
```

パネルでできること:
- 現在の `status.json` 表示
- `progress.txt` / `questions.log` / `events.log` の末尾表示
- 「更新」ボタンで即時更新
- 回答を入力して `answers.txt` に追記（次反復のプロンプト末尾に自動注入）

## 5) 質問が来ても止まらない運用

AIが `<question>...</question>` を出した場合:
1. CLIに質問を表示
2. Discordへ通知
3. `questions.log` に記録
4. ただし **ループは停止せず続行**

人間が `answers.txt`（またはWebパネル）で回答すると、次回以降のプロンプト末尾に以下形式で自動追記されます。

- `先ほどの質問の回答が届きました。以下を踏まえて作業を続けてください。`

## 6) 主な環境変数

```bash
MAX_ITERATIONS=20 \
SLEEP_SECONDS=1 \
SHOW_PROGRESS_LINES=8 \
AI_OUTPUT_PREFIX="🤖 AI> " \
STATUS_FILE="status.json" \
ANSWER_FILE="answers.txt" \
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
./ralph-loop/ralph.sh "codex exec --full-auto"
```

- `MAX_ITERATIONS`（既定: `10`）
- `SLEEP_SECONDS`（既定: `2`）
- `SHOW_PROGRESS_LINES`（既定: `5`）
- `AI_OUTPUT_PREFIX`（既定: `🤖 AI> `）
- `DISCORD_WEBHOOK_URL`（任意）
- `STATUS_FILE`（既定: `status.json`）
- `ANSWER_FILE`（既定: `answers.txt`）

## 7) 追加ファイル

- `status.json`: 現在状態（パネル/監視用）
- `questions.log`: AI質問ログ
- `events.log`: 通知イベントログ（Discordなし運用の主通知面）
- `answers.txt`: 人間回答ログ
- `.answers.offset`: どこまで回答を注入済みかの内部管理
