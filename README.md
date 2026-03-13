# Ralph Loop（暫定運用向け）

このリポジトリは、LuLOS を作るまでの一時運用でも使いやすいように、Ralph を **止めずに回し続ける** ための機能をまとめています。

- CLIで進捗が見える
- AIの発話を明確に見分けられる
- Discord通知（任意）
- Webパネルだけでも同等の監視・回答入力ができる
- AIから質問が出ても、回答待ちで停止せず継続する

## 1) 使い方（基本）

```bash
chmod +x ./ralph-loop/ralph.sh
./ralph-loop/ralph.sh "codex exec --full-auto" 20
```

## 2) Webパネル

```bash
python3 ./ralph-loop/dashboard.py
# http://localhost:8787
```

Webパネルでは、現在状態やログ末尾の確認、`answers.txt` への回答追記ができます。

## 3) Discord通知（任意）

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
./ralph-loop/ralph.sh "codex exec --full-auto" 20
```

Discordを使わない場合でも、同等の通知は `events.log` に保存され、Webパネルから確認できます。

## 4) ループを止めない質問対応

AIが以下を出力した場合:

```text
<question>...</question>
```

Ralph は質問をログ・通知しつつ処理を継続します。`answers.txt` に追記した新しい回答は、次回プロンプトへ自動で注入されます。
