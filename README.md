# 叙线 · Galgame Notebook 2.0

离线 AVG 剧本编辑器，支持多路线、章节解锁、剧情/调查阶段、分支合流/跳转、对白与演出描述、行排序、撤销及 JSON/Markdown 导出。

**[下载 Windows 桌面版](https://github.com/piayboy894/Galgame-Notebook/releases/latest)**：选择 `Xuxian_版本号_x64-setup.exe`。安装后打开「Xuxian」，无需启动浏览器、PowerShell 或本地服务器。支持 Windows 10/11 x64，安装器按需安装微软 WebView2。

## 更新与剧本

- 项目列表右上角「检测更新」，或「更多 → 检测 GitHub 更新」，发现新版后点击「保存并一键更新」。只在点击时联网。
- 更新前保存、备份并校验安装包签名。保存、备份、下载或校验失败时停止更新。
- 剧本位于系统「文档/叙线/剧本项目」，独立于安装目录。每次保存保留自动备份，删除移至 `_回收站`。
- v1.8 用户先安装新版，点击「导入旧版文件夹」，选择旧包的「剧本项目」。仅复制有效 JSON，按 ID 跳过重复项目，保留原文件。也可单独导入 JSON v1–v3。
- 旧浏览器草稿请先在旧版保存或导出 JSON，再导入桌面版。

## 开发

需要 Node.js 22、稳定版 Rust 和 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run desktop
npm test
cargo test --locked --manifest-path crates/story-store/Cargo.toml
npm run build
npm run desktop:build
```

`npm run dev` 仅为前端预览，不提供原生文件库/更新。回归测试：安装 Python Playwright，启动预览后执行 `npm run test:e2e`。默认 Chromium 路径 `/usr/bin/chromium`，可通过 `CHROMIUM_PATH` 配置。

Tauri 2 + Rust 文件核心 + TypeScript 应用服务 + 模块化 DOM 编辑界面。参阅 [架构说明](docs/architecture.md) 与 [发布维护](docs/releases.md)。旧版归档在 `legacy/v1.8`，不参与新版构建。MIT 许可见 [LICENSE](LICENSE.txt)。
