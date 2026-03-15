# Releasing RalphLoop

## v1.0 release gate

1. `npm run lint`
2. `npm test`
3. `npm run check`
4. `npm run smoke`
5. `npm run build`
6. `./ralph demo`
7. panel の主要導線を目視確認
8. `CHANGELOG.md` を更新
9. `package.json` の version を更新
10. git tag を切る

## panel で最低限確認すること

- `いまやること` が current status に応じて切り替わる
- `クイック送信` からメモ / Task / 回答が送れる
- Task の作成 / 編集 / 完了 / reopen が動く
- pending question が来たときに回答先 select が更新される
- `実行開始 / 一時停止 / 再開 / 中断` の可否が状態依存で切り替わる
- `agentCommand` が固定設定のとき、panel では read-only として表示される

## 自動化されている範囲

- GitHub Actions では `lint / test / check / smoke / build` まで自動で回す
- `npm run smoke` は demo を headless 起動し、質問発生から回答注入、完了までを確認する
- panel の見た目や情報優先順位の最終確認だけは人の目で見る

## 推奨タグ

- `v1.0.0`
- `v1.0.1`
- `v1.1.0`

SemVer を守り、互換性が壊れる変更は minor ではなく major で切ります。
