# NewsNow

![](screenshots/preview-1.png)

![](screenshots/preview-2.png)

English | [简体中文](README.zh-CN.md) | [日本語](README.ja-JP.md) · [Live demo](https://newsnow-1nq.pages.dev/c/realtime)

> [!NOTE]
> NewsNow is a self-hostable project. The interface is currently Chinese-first; English source titles are translated to Chinese while the original publisher link is retained.

***A fast, source-aware dashboard for global news and live information***

## Features
- Fast refresh with a per-source schedule, last-successful snapshot fallback, and an explicit latest refresh action
- Chinese-first reading experience with translated titles and links to the original source
- 48 active source feeds across news, markets, weather, technology, social posts, and public institutions
- GitHub OAuth login with optional cross-device preference synchronization
- A curated hottest view that prefers accountable newsrooms, wire services, official releases, and public broadcasters

## Current coverage

- **Global markets:** US, China, Japan, and South Korea market indexes, plus the US Dollar Index and gold
- **Weather and events:** IP-estimated local weather, Beijing weather, typhoons, and recent global earthquakes
- **US and technology:** Trump Truth Social, Tibo and OpenAI on X, US-focused AI news, GitHub Trending, and Apple News/Podcasts
- **Finance and central banks:** Pi Network, Federal Reserve updates, Reuters, AP, AFP, Bloomberg, Financial Times, WSJ, and Nikkei Asia
- **International news:** BBC News, BBC World Service, DW, France 24, NHK World, The Economist, RFI, and UN News
- **China coverage:** The Chinese government website, People's Daily, China News Service, Xinhua English, and SCMP

Source availability depends on the publisher and its public feed. When an upstream service is unavailable, NewsNow keeps the last successful snapshot and marks the refresh state instead of presenting it as new. Translation is machine-assisted and should not be treated as an official translation.

## Deployment

### Basic Deployment
For a basic deployment without login or persistent caching:
1. Fork this repository
2. Import to platforms like Cloudflare Pages or Vercel

### Cloudflare Pages configuration
- Build command: `pnpm run build`
- Output directory: `dist/output/public`

### GitHub OAuth Setup
1. [Create a GitHub App](https://github.com/settings/applications/new)
2. No special permissions required
3. Set callback URL to: `https://your-domain.com/api/oauth/github` (replace `your-domain` with your actual domain)
4. Obtain Client ID and Client Secret

### Environment Variables
Refer to `example.env.server`. For local development, rename it to `.env.server` and configure:

```env
# GitHub Client ID
G_CLIENT_ID=
# GitHub Client Secret
G_CLIENT_SECRET=
# JWT Secret, usually the same as Client Secret
JWT_SECRET=
# Initialize database, must be set to true on first run, can be turned off afterward
INIT_TABLE=true
# Whether to enable cache
ENABLE_CACHE=true
```

### Database Support
Supported database connectors: https://db0.unjs.io/connectors
**Cloudflare D1 Database** is recommended.
1. Create D1 database in Cloudflare Worker dashboard
2. Configure database_id and database_name in wrangler.toml
3. If wrangler.toml doesn't exist, rename example.wrangler.toml and modify configurations
4. Changes will take effect on next deployment

### Docker Deployment
In project root directory:

```sh
docker compose up
 ```

You can also set Environment Variables in `docker-compose.yml`.

## Development
> [!Note]
> Requires Node.js >= 20

```sh
corepack enable
pnpm i
pnpm dev
 ```

### Adding data sources
Register source metadata in `shared/pre-sources.ts`, implement the getter in `server/sources/`, and add parser tests under `test/`. Keep the original publisher URL and publication timestamp whenever the upstream feed provides them.

### Verification

```sh
pnpm test
pnpm typecheck
pnpm build
```

## Source and usage notes

- NewsNow is an aggregator, not a news publisher or fact-checking service.
- Publisher names, logos, article text, and feeds remain subject to their respective owners' terms.
- A source can be delayed, rate-limited, blocked, or temporarily unavailable; no feed is guaranteed to be complete or error-free.
- Do not use the dashboard for investment, emergency, medical, legal, or other high-stakes decisions without checking the original source.

***release when ready***
![](https://testmnbbs.oss-cn-zhangjiakou.aliyuncs.com/pic/20250328172146_rec_.gif?x-oss-process=base_webp)

## Contributing
Contributions are welcome! Feel free to submit pull requests or create issues for feature requests and bug reports.

## License

[MIT](./LICENSE). The project is based on [ourongxing/newsnow](https://github.com/ourongxing/newsnow/); see `LICENSE` for the upstream and current-maintainer copyright notices.

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
