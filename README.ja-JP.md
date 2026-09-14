# NewsNow

![](screenshots/preview-1.png)
![](screenshots/preview-2.png)

[English](./README.md) | [简体中文](README.zh-CN.md) | 日本語 · [オンラインデモ](https://newsnow-1nq.pages.dev/c/realtime)

> [!NOTE]
> NewsNow はセルフホスト可能なニュースアグリゲーターです。現在は中国語を中心とした表示で、英語ソースの見出しを中国語に翻訳し、元の配信元リンクを保持します。

***世界のニュースとリアルタイム情報をすばやく読むダッシュボード***

## 機能
- ソースごとの更新間隔、最新更新、最後に成功したスナップショットへのフォールバック
- 中国語を中心とした表示、翻訳見出し、元記事へのリンク
- ニュース、株式市場、天気、テクノロジー、SNS、公共機関を含む48の有効なフィード
- GitHub OAuthログインと、任意のクロスデバイス設定同期
- 編集責任の明確な報道機関、通信社、公式発表、公共放送を優先した「最も注目」ビュー

## 現在の対象範囲

- **世界の市場：** 米国、中国、日本、韓国の主要指数、米ドル指数、金
- **天気とイベント：** IP推定の現在地、北京、台風、最近の世界の地震
- **米国とテクノロジー：** Trump Truth Social、Tibo と OpenAI の X、米国AI、GitHub Trending、Apple News/Podcasts
- **金融と中央銀行：** Pi Network、FRB、Reuters、AP、AFP、Bloomberg、Financial Times、WSJ、Nikkei Asia
- **国際ニュース：** BBC News、BBC World Service、DW、France 24、NHK World、The Economist、RFI、UN News

配信元の公開フィードが利用できない場合、NewsNow は最後に成功したスナップショットを保持し、更新状態を表示します。古い内容を新着として扱うことはありません。翻訳は機械による補助であり、配信元の公式訳ではありません。

## デプロイ

### 基本デプロイ
ログインとキャッシュ機能なしでデプロイする場合：
1. このリポジトリをフォーク
2. Cloudflare PagesやVercelなどのプラットフォームにインポート

### Cloudflare Pages設定
- ビルドコマンド：`pnpm run build`
- 出力ディレクトリ：`dist/output/public`

### GitHub OAuth設定
1. [GitHub Appを作成](https://github.com/settings/applications/new)
2. 特別な権限は不要
3. コールバックURLを設定：`https://your-domain.com/api/oauth/github`（your-domainを実際のドメインに置き換え）
4. Client IDとClient Secretを取得

### 環境変数
`example.env.server`を参照。ローカル開発では、`.env.server`にリネームして以下を設定：

```env
# GitHub Client ID
G_CLIENT_ID=
# GitHub Client Secret
G_CLIENT_SECRET=
# JWT Secret（通常はClient Secretと同じ）
JWT_SECRET=
# データベース初期化（初回実行時はtrueに設定）
INIT_TABLE=true
# キャッシュを有効にするかどうか
ENABLE_CACHE=true
```

### データベースサポート
対応データベースコネクタ： https://db0.unjs.io/connectors Cloudflare D1 Database を推奨。

1. Cloudflare WorkerダッシュボードでD1データベースを作成
2. `wrangler.toml` に `database_id` と `database_name` を設定
3. `wrangler.toml` が存在しない場合、 `example.wrangler.toml` をリネームして設定を変更
4. 次回デプロイ時に変更が反映

### Dockerデプロイ
プロジェクトルートディレクトリで：

```sh
docker compose up
 ```

環境変数は `docker-compose.yml` でも設定可能。

## 開発
> [!TIP]
> Node.js >= 20が必要

```sh
corepack enable
pnpm i
pnpm dev
 ```

### データソースの追加
データソースを追加する場合は、`shared/pre-sources.ts` にメタデータを登録し、`server/sources/` に取得処理を実装し、`test/` にパーサーテストを追加してください。可能な場合は元記事のURLと公開時刻を保持してください。

### 検証

```sh
pnpm test
pnpm typecheck
pnpm build
```

## データソースと利用上の注意

- NewsNow は集約ツールであり、ニュース発行元やファクトチェック機関ではありません。
- 媒体名、ロゴ、記事、フィードは各権利者の所有物であり、各利用規約に従います。
- ソースは遅延、レート制限、ブロック、一時停止の影響を受けるため、完全性や無障害を保証しません。
- 投資、緊急対応、医療、法律などの重要な判断では、必ず元の配信元を確認してください。

## コントリビューション
コントリビューションを歓迎します！機能リクエストやバグレポートのために、プルリクエストやイシューの作成をお気軽にどうぞ。

## ライセンス
MIT。上流プロジェクトは [ourongxing/newsnow](https://github.com/ourongxing/newsnow/) です。上流作者と現在のメンテナーの著作権表示は `LICENSE` を参照してください。

# 🙏 感谢
[ourongxing](https://github.com/ourongxing/newsnow/)

 #
<center>
<details><summary><strong> [点击展开] 赞赏支持 ~🧧</strong></summary>
*我非常感谢您的赞赏和支持，它们将极大地激励我继续创新，持续产生有价值的工作。*

- **USDT-TRC20:** `TWTxUyay6QJN3K4fs4kvJTT8Zfa2mWTwDD`
- **TRX-TRC20:** `TWTxUyay6QJN3K4fs4kvJTT8Zfa2mWTwDD`

<div align="center">
  <img src="https://github.com/user-attachments/assets/e6cdc42a-6374-4722-b833-601738f72196" width="200"></br>
  TRC10/TRC20扫码支付
</div>
</details>
</center>

 #
 免责声明:
 - 1、该项目设计和开发仅供学习、研究和安全测试目的。请于下载后 24 小时内删除, 不得用作任何商业用途, 文字、数据及图片均有所属版权, 如转载须注明来源。
 - 2、使用本程序必循遵守部署服务器所在地区的法律、所在国家和用户所在国家的法律法规。对任何人或团体使用该项目时产生的任何后果由使用者承担。
 - 3、作者不对使用该项目可能引起的任何直接或间接损害负责。作者保留随时更新免责声明的权利，且不另行通知。
