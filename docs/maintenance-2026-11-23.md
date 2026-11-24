# 2026-11-23 日常维护

## 范围与基线

生产项目仍为 `newsnow-original/` → `ChrisQi0417/newsnow` → Cloudflare Pages `newsnow`。保留 48 个来源、28 个媒体模块、布局、中文显示、正常采集周期、手动刷新与故障退避。不增加定时任务、代理或付费订阅。

维护前本地与 GitHub main 均为 `26cdaa7`，Cloudflare 对应部署成功。一次普通线上巡检覆盖全部 48 个来源，串行且每次间隔至少 5 秒：47 个来源采集可用，13 个中文完整，811 条标题仍为英文。X 缺失 OpenAI 账号（上游 429）；Truth Social 本次刷新同样被上游 429 限流，保留旧缓存。不能将 HTTP 200 或部分数据视为全部恢复。

## 根因与修复

1. 原翻译模型 `@cf/qwen/qwen3-30b-a3b-fp8` 已于 2026-11-20 停用。Cloudflare 官方说明停用后返回 HTTP 410 / 错误码 5028，与本次广泛翻译失效一致。迁移到官方推荐的 `@cf/google/gemma-4-26b-a4b-it`，按当前 schema 调整结构化输出并关闭思考模式。首轮上线抽验发现部分批次超时，将每批上限由 10 条降至 8 条，单次时限由 10 秒调整至 14 秒。总时限仍为 18 秒，并发上限 2，调用上限 6。模型停用单独记录为 `workers-ai:model-retired`。
2. 普通单源请求可通过原 AI 绑定补译缓存。补译结果按采集版本单独保存，避免覆盖同时完成的新采集。每来源至少 15 分钟补译冷却，同实例合并并发请求。原采集时间、账号状态和源退避继续生效。缓存水合接口仅读取现有媒体缓存，页面按正常刷新周期逐步显示新译文。
3. 手动维护脚本识别部分成功、缺失账号和中文翻译失败，中文报告具体异常，避免误报成功；请求频率不变。

## 下次维护的检查顺序

- 核对生产目录、Git remote、提交及部署状态，再以普通请求串行巡检；不以强刷全站作为默认诊断。
- 多家英文源同时退回英文而新闻仍更新时，先检查翻译模型是否停用、AI 绑定和翻译诊断，不逐家反复抓取媒体。
- 对 429、403 等拒绝继续遵守已有冷却；不要清除退避或换代理绕过。
- 修改后运行测试、类型检查、lint 和 Cloudflare 构建；发布后检查真实内容、中文完整性、原始发布时间及部分账号状态。
- 本次没有设置后台监控或定时维护。模型目录应在后续维护时复核，不能把当前支持状态视为永久保证。

## 依据与验收记录

- [Cloudflare 2026-11-05 停用公告](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/)
- [Gemma 4 模型与定价](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [当前请求 schema](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/sync-input.json)

离线检查、生产基线与发布后验收保存在本地 `.cache/acceptance/2026-11-23-*`。原始抓取数据不提交。日期采用 America/Chicago；晚间检查对应 UTC 次日。
