# 课业手记官网

[打开官网](https://arrry-07.github.io/chaoxing-journal-site/) · [应用仓库](https://github.com/arrry-07/chaoxing-journal) · [下载 Android 正式版](https://github.com/arrry-07/chaoxing-journal/releases/latest)

课业手记的独立静态官网：暖纸色手账风格、真实应用截图、Android 安装指南、隐私边界和 GitHub Release 下载。

## 架构与发布

- 根目录原生 HTML、CSS 与 ES Modules；无前端框架、运行时依赖、账号系统、统计脚本、后端或 GitHub Token。
- `main` 分支与 Pull Request 运行 Node 测试、静态资源检查和 GitHub 正式 Release 契约检查。
- `main` 分支通过 GitHub Pages 官方 Actions 发布网站。仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
- 官网只托管说明与素材，不代理或重新上传 APK。下载按钮直接链接应用仓库 Release 的实际 APK 资产。
- `404.html` 使用 Pages 项目路径 `/chaoxing-journal-site/`；本地测试只针对首页，不模拟 Pages 的 404 回退路由。

## 下载版本与回退

`scripts/release-store.js` 是唯一版本与下载状态入口。页面初始 HTML 始终保留一个已核验的真实 APK 链接，禁用 JavaScript 或 GitHub API 暂不可达时仍可下载。

正常加载时，页面由 `resolveLatestRelease` 优先从 `https://api.github.com/repos/arrry-07/chaoxing-journal/releases/latest` 读取最新正式版，验证：

- 非草稿、非预发布；
- `vX.Y.Z` Tag 与 `chaoxing-journal-X.Y.Z.apk` 文件名对应；
- APK 与校验文件均位于应用仓库的同版本 GitHub Release 下载地址；
- APK 大小合理，API 提供的 `sha256:` 摘要格式合法。

当 `api.github.com` 超时（6 秒）、限流或不可达时，`resolveLatestRelease` 会尝试读取同源 `release.json`（`cache: 'no-store'`）并通过 `parseSiteReleaseManifest` 校验字段与来源；仅当 `release.json` 版本高于页面内嵌静态版本时无缝升级展示（用于标签页长驻或旧缓存命中场景），否则统一由 `scripts/site.js` 回退至内嵌版本。页面驻留期间还会结合可见性切换（60 秒节流）、网络恢复 `online`（5 秒节流）与可见态 5 分钟静默轮询刷新版本状态；版本号、摘要与可用性未变化时保留用户当前复制成功提示。

当前回退为 `1.8.24`，静态状态写作「已核验下载版本」，API 不可达且同源清单未领先时显示「已核验回退版本 · 暂时无法读取最新发布」，关闭 JavaScript 时同样成立；不会把旧 SHA-256 用于新版。未来新版若缺少同版本校验信息，下载仍可用，但页面不显式展示陈旧校验值。

**自动核验与同步（推荐）**：仓库已配置 `.github/workflows/sync-release.yml`（每 30 分钟巡检，亦支持 `app-release-published` `repository_dispatch` 与手动 `workflow_dispatch`）及本地命令 `npm run sync`（`node scripts/sync-release.js`，支持 `--dry-run`）。发现新正式版时，脚本会真实下载完整 APK 与同 Tag `SHA256SUMS.txt`，在确认「实际字节数 + 本地重算 SHA-256 + GitHub API `digest` + `SHA256SUMS.txt` 对应文件名行」四方完全一致后，才同步更新：

- `scripts/release-store.js` 中的 `FALLBACK_RELEASE`（版本、Tag、APK 名称、下载地址、发布页、校验文件地址、字节数与 SHA-256）；
- 根目录同源清单 `release.json`；
- `index.html` 中全部下载按钮、版本、大小、发布页、校验文件链接、摘要与无脚本状态；
- `README.md` 中的当前回退版本号。

同步脚本通过后由工作流运行全量校验并自动提交推送到 `main`，同时直接打包并发布最新 GitHub Pages 产物。若需手动更新 `tests/release-store.test.js` 等测试文件可额外补充；`tests/release-store.test.js` 的字节断言已动态跟随 `FALLBACK_RELEASE.size`。更新后运行 `npm run check`、`node scripts/package-site.js` 和 `git diff --check`。`scripts/check-site.js` 会逐一校验 `release.json` 一致性以及所有 `data-download`、版本、大小、发布页、校验地址和摘要，避免只改了一个按钮仍然通过。浏览器脚本同时覆盖强制 API 503 下载真实回退 APK（按实际文件名、字节数与 SHA-256 断言）以及 API 503 时从更高级 `release.json` 无缝升级的场景。

## 本地验证

需要 Node.js 22 或更新，无需安装 npm 依赖。

```sh
npm test
node --check scripts/site.js
node --check scripts/release-store.js
node --check scripts/sync-release.js
node scripts/sync-release.js --dry-run
node scripts/check-site.js
node scripts/package-site.js
npm run serve
```

打开 `http://127.0.0.1:4173/`。浏览器需支持原生 ES Modules；请通过本地 HTTP 服务预览，不以 `file://` 作为模块正常加载的验收环境。

`scripts/check-site.js` 验证所有发布文件（含 `release.json` 与 `FALLBACK_RELEASE` 一致性）、相对链接、锚点、截图、WOFF2 字体、基础无障碍属性和线上 Release 契约。测试使用固定数据，不发送账号或请求凭据；浏览器验收另外检查正常 API、异常回退、同源 `release.json` 兜底升级、禁用 JavaScript、手机布局、键盘操作与真实 APK 下载。CI 在官方 Actions 中使用自动注入的只读 `GITHUB_TOKEN` 避免 GitHub 匿名接口限流，令牌不进入网页、打包目录或日志；本地检查不使用该变量。

有可选 Playwright 环境时，可在启动预览后执行 `node scripts/browser-check.mjs`。它默认使用本机 Chrome；默认 URL 为 `http://127.0.0.1:4173/`，可通过 `SITE_QA_URL` 验证 Pages 项目路径；报告及下载包写入忽略的 `output/playwright/`。该脚本不属于网站运行或 Pages 发布依赖。

`scripts/package-site.js` 将明确允许的网页、样式、图片、字体、两个浏览器运行模块与 `release.json`（共 16 项白名单条目）写入忽略的 `public/`，作为 Pages 的唯一打包输入；`scripts/sync-release.js` 等维护脚本不进入 `public/`。完整 `LICENSE` 与 `OFL-WenKai.txt` 保留在源码仓库，静态产物中同时携带字体许可；发布网站通过应用仓库和字体来源链接提供相应许可说明。

应用指南含历史版本说明，当前网站只使用 API 接受的 `vX.Y.Z` 正式包命名方案；应用约定修改时，下载校验需同步保持与实际发布一致。

## 素材与许可

- 应用图标`cat_app_icon.png`与首页/统计/我的界面截图来自[应用仓库](https://github.com/arrry-07/chaoxing-journal)。截图使用合成样例数据，不包含真实账号信息。
- 三张应用截图与原始文件逐字节一致，不修改截图内状态与文字。猫咪图标从应用原图等比缩放为 256px，补上暖纸底色，编码成 `cat-app-icon.webp`；分享用 `app-launcher.png` 同样从该应用图标生成，不使用第三方标识。
- `assets/font/LXGWWenKaiScreen.woff2` 从应用仓库内置的 LXGW WenKai Screen TTF 裁剪为官网文案所需字形并通过 WOFF2 网页字体交付，保留网页排版所用映射，不添加或重绘字形，不作为桌面字体发布。字体族名使用 `Journal Serif`，不把裁剪文件冒称完整原始字体。原始版权与 SIL OFL 1.1 完整保留在 `assets/font/OFL-WenKai.txt`，其附加许可允许该网页交付转换。原始 TTF 与转换规范见[字体来源仓库](https://github.com/lxgw/LxgwWenKai-Screen)。
- 网站源码按 `LICENSE` 中的 MIT 许可使用；应用与素材各自的上游许可不因本网站许可改变。

## 维护范围

当前下载区只有 Android；没有 iOS、Windows、macOS 的未发布下载按钮。如果未来新增已验收平台，扩展下载组件与对应验证后再上线，不释放“敬请期待”的假按钮。

应用功能、隐私与兼容性以应用仓库的实际实现和当前指南为准。本仓库变更不替换应用版本、不修改应用签名、不代替 APK 发布验收。
