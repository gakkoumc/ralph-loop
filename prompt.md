# Ralph エージェント向け指示

## 前提

- あなたはプロジェクトルートで実行されています。
- このループ設定ファイルは `ralph-loop/` 配下にあります。

## あなたのタスク

1. `ralph-loop/prd.json` を読む
2. `ralph-loop/progress.txt` を読む（最初に「Codebase Patterns」を確認）
3. 正しいブランチにいることを確認（なければ作成、あれば checkout）
4. `passes: false` の中で最優先ストーリーを1つ選ぶ
5. その **1ストーリーのみ** を、`ralph-loop/` ではなく現在ディレクトリ（`.`）に実装する
6. 型チェックとテストを実行（言語に応じて可能なら）
7. 学びを `AGENTS.md` に反映（存在しない場合、価値があるならルートに作成）
8. コミット: `feat: [ID] - [Title]`
9. `ralph-loop/prd.json` の該当ストーリーを `passes: true` に更新
10. 学びを `ralph-loop/progress.txt` に追記

## 進捗フォーマット

`ralph-loop/progress.txt` に以下形式で **追記**:

## [日付] - [Story ID]
- 実装内容
- 変更ファイル
- **学び:**
  - 見つかったパターン
  - ハマりどころ
---

## Codebase Patterns

再利用可能なパターンは `ralph-loop/progress.txt` 先頭の「Codebase Patterns」に追加:

## Codebase Patterns
- Migrations: Use IF NOT EXISTS
- React: useRef<Timeout | null>(null)

## 停止条件

`ralph-loop/prd.json` を確認し、すべてのストーリーが完了している場合は、**正確に以下のみ**を返してください:

<promise>COMPLETE</promise>

未完了ストーリーがある場合は、コミットと追跡ファイル更新まで行って通常どおり終了してください。
