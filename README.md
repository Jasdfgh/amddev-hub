# AMD Developer Hub

面向 Radeon、ROCm 与本地 AI 开发者的资料和社区入口。正式地址：<https://hub.amddev.ai/>。

这是一个原生 HTML/CSS/JavaScript 静态网站，无后端、数据库或本站登录；登录和技术支持入口跳转到对应外部平台。

## 本地维护

需要 Node.js 22 或以上，无需安装 npm 依赖。

```bash
node scripts/build.mjs
node scripts/prepare-release.mjs
node scripts/validate-release.mjs
node scripts/preview.mjs
```

打开 <http://127.0.0.1:4180/>。预览服务只监听本机。

- 内容、卡片和外链：`site/index.html`。
- 页面布局：`site/journey.css`，配色：`site/custom.css`。
- 交互：`site/app.js`，图片和字体：`site/assets/`。
- `original/` 保留收到的页面快照，供构建检查与追溯使用。
- `diagnostics/` 为独立网络检查工具，部署到 `/__network-check/`，不出现在产品导航里。
- `dist/` 是构建产物，`provenance/` 是本机构建和校验记录，均不入库。

GitHub 提问链接指向现有模板文件，这是有意设计，构建校验会防止误改为其他入口。页面中的汇总数字是编辑提供的固定文案，不是实时统计。

## 发布

构建第一阶段按字节复制并校验资源；第二阶段为 CSS、JavaScript、图标和二维码添加内容指纹，生成发布标识和 EdgeOne 配置。源文件中的相对路径仍便于人工维护。

上传 `dist/` 内的内容，确保 ZIP 根目录直接包含 `index.html`。只上传构建产物，不能上传源码工程、凭据或本地配置。

当前托管使用腾讯云 EdgeOne Makers 中国站账号、`overseas` 加速区域，正式域名为 `hub.amddev.ai`。平台项目内部名称暂保留 `amddev-hub-probe`，同一项目已具备域名及 HTTPS 配置。发布脚本使用 CLI 更新这个项目；不需要重新绑定域名或申请证书。

已登录 EdgeOne CLI 后，可先发布预览环境，再发布生产环境：

```bash
npx --yes --package=edgeone@1.6.46 edgeone makers deploy dist --name amddev-hub-probe --area overseas --env preview --skip-ai-gateway-sync
npx --yes --package=edgeone@1.6.46 edgeone makers deploy dist --name amddev-hub-probe --area overseas --env production --skip-ai-gateway-sync
```

部署命令会发布对应环境的新版本。平台历史部署及留存的发布 ZIP 用于回滚。需要初次登录时使用 `edgeone login --site china`；API Token、真实 `.env` 和账号资料不入库。

## 访问与防护

- 主页面不自动访问第三方 CDN、字体或统计服务；资源都由本站提供。外部链接只有用户点击后才会访问。
- 有内容指纹的 CSS、JS、字体采用长期缓存，首页使用短期边缘缓存并要求浏览器重新验证。
- 二维码图片延迟加载；保留原始图像数据和下载名称。
- CSP 限制脚本、样式和字体来源，禁止页面被嵌入框架；同时配置 MIME 嗅探防护、Referrer Policy、Permissions Policy 和短期 HSTS。
- `robots.txt` 保留正常搜索抓取，要求部分商业 SEO 爬虫停止抓取；它是爬虫约定，不是访问控制或 DDoS 防护。
- 流量、状态码、缓存命中与安全事件使用 EdgeOne 自带统计。没有新增前端追踪脚本。
- DDoS、CC 和机器人行为防护属于 EdgeOne 控制台策略，不能仅通过 `edgeone.json` 声称已经开启；具体配置及是否生效需要独立核验。

2026-10-27 上线时的控制台基线：用户截图确认自适应频控已开启，当前每个访问者 2000 次 / 5 秒，等级为“自适应·宽松”，处置方式为 JavaScript 挑战。HTTP → HTTPS 的 301 跳转已实测生效。该频控数字是请求计数，不是在线人数；后续按安全日志调整，避免误伤会场共用出口的正常访问。

网络检查地址：<https://hub.amddev.ai/__network-check/>。测试者需关闭 VPN / 代理并填写实际网络，结果仅留在当前页面，由本人决定是否分享。该检查不能替代正式页面、外链、二维码及不同地区的验收。

## 来源与第三方材料

基础页面来自 Annie 于 2026-10-27 交付的 `2026-10-27-redblack-v30` 版本；本仓库加入部署配置、缓存指纹、搜索入口和网络检查工具。

本项目自行编写的代码采用 MIT 许可。Geist 字体、Tailwind CSS 和 Lucide 图标保留各自许可，许可文本位于 `site/assets/licenses/`。AMD 名称、标识及其他第三方内容的权利归各自权利人所有；代码许可不授予额外的商标使用权，也不替代第三方材料的许可。
