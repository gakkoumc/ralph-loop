# Contributing

## 開発の前提

- Node.js 24 以上
- `npm run lint`
- `npm test`
- `npm run check`
- `npm run smoke`
- `npm run build`

## 開発フロー

1. 変更前に `./ralph check` で設定不備がないことを確認する
2. 変更後に `npm run lint && npm test && npm run check && npm run smoke && npm run build` を通す
3. panel を触った場合は `./ralph demo` で導線を目視確認する
4. 仕様変更がある場合は `README.md` と `CHANGELOG.md` を更新する

## 変更方針

- state / action / panel / Discord の責務を混ぜない
- UI に状態遷移を埋め込まない
- file based state を前提に、重い依存を増やさない
- 1 run で 1 Task を確実に前へ進める思想を崩さない
