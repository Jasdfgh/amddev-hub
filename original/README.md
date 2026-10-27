# AMD 开发者社区网站

静态 HTML 网站，直接双击 index.html 即可打开，无需安装依赖。也可以将本目录上传到支持静态文件的托管平台。

## 开发者旅程

Token Factory → Radeon Cloud → 注册 AMD 开发者计划领取免费算力 → AIGC生成图片视频 → 技术内容 → 提需求与痛点 → 技术支持 → 沉淀 insights → 技术群交流。

- 首屏及前三个核心入口突出体验、云端实践、注册与算力领取。
- Creative Factory 作为主路径后的辅助创作入口。
- 学习区保留精选文章与视频，四个社区内容入口以四宫格直接展示。
- 需求与支持连接现有 GitHub 指南及社区答疑。
- 分享与交流区连接小红书、知乎、B站，再引导回到工具。

## 修改

- 页面内容、卡片、链接与旅程顺序：index.html
- 开发者旅程布局与响应式样式：journey.css
- 红黑统一配色：custom.css
- 原站基础样式：assets/theme.css、assets/styles.css
- 路径当前位置提示：app.js
- 本地字体：assets 中的 woff2 文件

账户、算力、内容和技术交流入口均跳转到原平台。本站没有登录、投稿、工单或客服后台。底部统计为页面展示文案。

顶部与底部的小红书入口：https://www.xiaohongshu.com/user/profile/6a6b08ac0000000013030800
参考站：https://n1j2h80v10m1-d.space-z.ai/#channels

- 底部技术群二维码：assets/amd-developer-group-qr.png，保留原图比例与白色留白。

- 底部社区平台区：#community-platforms，小红书使用用户提供的 rednote 主页链接。

- 二维码配色显示与下载版：assets/amd-developer-group-qr-color.png；可编辑配色源：同名 SVG。黑白原图仍保留。
