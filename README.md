# Web QA Checker 🔍

Webサイトの品質をワンクリックで診断するツールです。URLを入力するだけで、約100項目の品質チェックを自動実行し、美しいHTMLレポートを生成します。

## チェック項目

| カテゴリ | 内容 |
|---|---|
| **HTML品質** | W3Cバリデーション、デバッグコード残存 |
| **内部SEO** | title/meta、見出し構造、alt属性、lang |
| **リンク** | 内部/外部リンク切れ検出 |
| **画像** | ファイルサイズ、WebPフォーマット |
| **レスポンシブ** | 3ブレークポイント検証 |
| **パフォーマンス** | LCP、CLS計測 |
| **セキュリティ** | HTTPS、セキュリティヘッダー |
| **WordPress** | ログインURL、バージョン露出 |

## デプロイ（Render.com）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

1. リポジトリをフォーク
2. Render.comでアカウント作成
3. 「New Web Service」→ このリポジトリを選択
4. Runtime: Docker を選択
5. Plan: Free を選択
6. 「Deploy」をクリック

## ローカル実行

```bash
npm install
npx playwright install --with-deps chromium
node server.js
# → http://localhost:3200
```

## 技術スタック

- **Node.js** + **Express** — サーバー
- **Playwright** — ヘッドレスブラウザ
- **EJS** — レポートテンプレート

## 制限事項（無料枠）

- 同時チェック: 1件まで
- レート制限: 同一IPから1分に1回
- チェック対象ページ: 最大5ページ（サイトマップから自動検出）
