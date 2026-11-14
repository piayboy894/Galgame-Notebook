# 叙线 · Galgame Notebook 2.2

离线 AVG 剧本编辑器，支持多路线、章节解锁、剧情/调查阶段、分支合流/跳转、对白与演出描述、行排序、撤销及 JSON/Markdown 导出。

**[下载 Windows 桌面版](https://github.com/piayboy894/Galgame-Notebook/releases/latest)**：选择 `Xuxian_版本号_x64-setup.exe`。安装后打开「Xuxian」，无需启动浏览器、PowerShell 或本地服务器。支持 Windows 10/11 x64，安装器按需安装微软 WebView2。

## GitHub 数据同步

在「更多 → GitHub 同步设置」配置私有仓库、分支、数据目录和 Fine-grained Token（仅授权数据仓库的 Contents 读写权限）。点击顶部「一键同步」，先保存本地，再上传或拉取变化；双方修改时保留副本并提示选择。Token 保存在本机 Windows 凭据管理器，剧本和导出不携带凭据。

默认只读写 `xuxian/projects/`，可与其他软件共用仓库。换电脑后，在项目列表的「GitHub 数据」中配置同一连接，预览并恢复项目。仅在点击时联网，断网仍可本地编辑。设置和冲突规则见 [GitHub 同步说明](docs/github-sync.md)。

## 场景编排

- 在路线图点击「地点」，维护背景、BGM、环境音、备注和自定义属性。
- 选中同一段脚本内的连续行，按 Ctrl/⌘+G 建立场景组，关联地点并备注本段场景。组内可单独覆盖预设属性。
- 场景组支持折叠、复制、移动、取消分组和撤销，适用于剧情、调查物品及选项内脚本。
- 右键行号或空白处，选择上方／下方插入对白或描述。文字输入框保留系统文本菜单。
- 保存按钮旁的文件夹图标，或「更多 → 打开源文件所在文件夹」，可定位当前 JSON。
- 新功能使用 JSON v4；旧文件读取后在保存时迁移并备份。旧版编辑器无法读取 v4，请使用新版继续编辑。

设计规则见 [场景编排设计](docs/scene-editing-design.md)，版本变化见 [更新记录](CHANGELOG.md)。

## 更新与剧本

- 项目列表右上角「检测更新」，或「更多 → 检测 GitHub 更新」，发现新版后点击「保存并一键更新」。只在点击时联网。
- 更新前保存、备份并校验安装包签名。保存、备份、下载或校验失败时停止更新。
- 剧本位于系统「文档/叙线/剧本项目」，独立于安装目录。每次保存保留自动备份，删除移至 `_回收站`。
- v1.8 用户先安装新版，点击「导入旧版文件夹」，选择旧包的「剧本项目」。仅复制有效 JSON，按 ID 跳过重复项目，保留原文件。也可单独导入 JSON v1–v4。
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

`npm run dev` 仅为前端预览，不提供原生文件库/更新。回归测试：安装 Python Playwright 及 Chromium 后执行 `npm run test:e2e`，会按需启动预览。支持通过 `CHROMIUM_PATH` 配置浏览器路径；测试包括模拟原生 IPC 的更新流程，不实际安装更新。

Tauri 2 + Rust 文件核心 + TypeScript 应用服务 + 模块化 DOM 编辑界面。参阅 [架构说明](docs/architecture.md) 与 [发布维护](docs/releases.md)。旧版归档在 `legacy/v1.8`，不参与新版构建。MIT 许可见 [LICENSE](LICENSE.txt)。
