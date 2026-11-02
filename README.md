# AMD Developer Hub

面向 Radeon、ROCm 与本地 AI 开发者的资料和社区入口。正式地址：<https://hub.amddev.ai/>。

内容页面使用原生 HTML/CSS/JavaScript，用户无需登录即可浏览；登录和技术支持入口仍跳转到对应外部平台。启用统计的发布版另外包含腾讯边缘函数 `/api/collect`，转发到独立的统计后台；内容站本身不保存数据库凭据，也不提供后台管理入口。

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
- 统计配置与审阅清单：`analytics/`；`site/analytics.js` 由共享模块生成，不能手改。配置、重新生成及发布前校验见 [统计接入说明](analytics/README.md)。
- `original/` 保留收到的页面快照，供构建检查与追溯使用。
- `diagnostics/` 为独立网络检查工具，部署到 `/__network-check/`，不出现在产品导航里。
- `dist/` 是构建产物，`provenance/` 是本机构建和校验记录，均不入库。

GitHub 提问链接指向现有模板文件，这是有意设计，构建校验会防止误改为其他入口。页面中的汇总数字是编辑提供的固定文案，不是实时统计。

## 发布

构建第一阶段按字节复制并校验资源；第二阶段为 CSS、JavaScript、图标和二维码添加内容指纹，生成发布标识和 EdgeOne 配置。源文件中的相对路径仍便于人工维护。

上传 `dist/` 内的内容，确保 ZIP 根目录直接包含 `index.html`。只上传构建产物，不能上传源码工程、凭据或本地配置。

启用采集时，`dist/` 还包含独立校验过的 `edge-functions/api/collect.js`。需要使用支持该服务端函数的 Makers 部署方式，不能只把 HTML 放到不执行函数的静态托管。真实上游地址和签名密钥只在平台对应环境配置，不进入浏览器脚本、Git 或 ZIP。本地预览不等于实际腾讯函数验收；仅正式域名启用的配置也不会在预览域名偷偷采集。

当前托管使用腾讯云 EdgeOne Makers 中国站账号、`overseas` 加速区域，正式域名为 `hub.amddev.ai`。平台项目内部名称暂保留 `amddev-hub-probe`，同一项目已具备域名及 HTTPS 配置。发布脚本使用 CLI 更新这个项目；不需要重新绑定域名或申请证书。

已登录 EdgeOne CLI 后，可先发布预览环境，再发布生产环境：

```bash
npx --yes --package=edgeone@1.6.46 edgeone makers deploy dist --name amddev-hub-probe --area overseas --env preview --skip-ai-gateway-sync
npx --yes --package=edgeone@1.6.46 edgeone makers deploy dist --name amddev-hub-probe --area overseas --env production --skip-ai-gateway-sync
```

部署命令会发布对应环境的新版本。平台历史部署及留存的发布 ZIP 用于回滚。需要初次登录时使用 `edgeone login --site china`；API Token、真实 `.env` 和账号资料不入库。

## 访问与防护

- 页面资源由本站提供，不依赖第三方 CDN、字体或第三方追踪脚本。启用统计时，本站生成的脚本只向同源 `https://hub.amddev.ai/api/collect` 上报；Cloud Run 与 Neon 的通信在服务端完成。外链目标页面仍只在用户点击后访问。
- 有内容指纹的 CSS、JS、字体采用长期缓存，首页使用短期边缘缓存并要求浏览器重新验证。
- 二维码图片延迟加载；保留原始图像数据和下载名称。
- CSP 限制脚本、样式和字体来源，禁止页面被嵌入框架；同时配置 MIME 嗅探防护、Referrer Policy、Permissions Policy 和短期 HSTS。
- `robots.txt` 保留正常搜索抓取，要求部分商业 SEO 爬虫停止抓取；它是爬虫约定，不是访问控制或 DDoS 防护。
- 流量、状态码、缓存命中与安全事件使用 EdgeOne 自带统计。有效访问和出口点击由本站采集器统计，在独立密码保护的只读看板 <https://stats.amddev.ai/> 查看；看板不向访客展示，也没有网页修改数据的入口。
- DDoS、CC 和机器人行为防护属于 EdgeOne 控制台策略，不能仅通过 `edgeone.json` 声称已经开启；具体配置及是否生效需要独立核验。

2026-10-27 上线时的控制台基线：用户截图确认自适应频控已开启，当前每个访问者 2000 次 / 5 秒，等级为“自适应·宽松”，处置方式为 JavaScript 挑战。HTTP → HTTPS 的 301 跳转已实测生效。该频控数字是请求计数，不是在线人数；后续按安全日志调整，避免误伤会场共用出口的正常访问。

网络检查地址：<https://hub.amddev.ai/__network-check/>。测试者需关闭 VPN / 代理并填写实际网络，结果仅留在当前页面，由本人决定是否分享。该检查不能替代正式页面、外链、二维码及不同地区的验收。

## 访问与点击统计

统计输入按后台验证的 Umami 原生访次计算，输出按同一访次中每个目标的首次有效点击计算；刷新或重复点同一目标不会简单累加。目录保留稳定目标 ID，对应当前 Hub 上的文章、视频、平台和社区入口；不跟踪用户跳转后在外部网站上的行为。部署记录需区分试运行数据和独立的生产网站 ID，不能把 demo 数量当作正式流量。

采集开启时页脚显示简短说明及“关闭统计”入口，并尊重浏览器 Do Not Track；关闭后清理本地匿名令牌和待发送状态。网络或统计后台故障不会取消、等待或阻止原链接跳转。统计是否实际开启取决于本次审阅的 `analytics/config.json`、构建产物及平台配置，仓库包含采集代码本身不代表已上线。

## 来源与第三方材料

基础页面来自 Annie 于 2026-10-27 交付的 `2026-10-27-redblack-v30` 版本；本仓库加入部署配置、缓存指纹、搜索入口和网络检查工具。

本项目自行编写的代码采用 MIT 许可。Geist 字体、Tailwind CSS 和 Lucide 图标保留各自许可，许可文本位于 `site/assets/licenses/`。AMD 名称、标识及其他第三方内容的权利归各自权利人所有；代码许可不授予额外的商标使用权，也不替代第三方材料的许可。
