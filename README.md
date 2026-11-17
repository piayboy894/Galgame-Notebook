# 叙线 · Galgame Notebook 2.5

离线 AVG 剧本编辑器，支持多路线、章节解锁、剧情/调查阶段、分支合流/跳转、对白与演出描述、行排序、撤销及 JSON/Markdown 导出。

**[下载 Windows 桌面版](https://github.com/piayboy894/Galgame-Notebook/releases/latest)**：选择 `Xuxian_版本号_x64-setup.exe`。安装后打开「Xuxian」，无需启动浏览器、PowerShell 或本地服务器。支持 Windows 10/11 x64，安装器按需安装微软 WebView2。

**[下载 Android 版](https://github.com/piayboy894/Galgame-Notebook/releases/latest)**：选择 `Xuxian_版本号_android.apk`，支持 Android 8.0+ ARM64 手机／平板及 x86_64 环境。按窗口宽高适配横竖屏、平板分屏和 Samsung DeX；手机使用底部导航和行内对白编辑，表情／动作在行内展开；软键盘工具栏可切换行和收起键盘。触屏路线图支持滑动浏览、短按打开章节、长按后拖动章节。平板、三星分屏与 DeX 保留直接编辑、鼠标右键、多选和键盘快捷键。

Android 项目保存在应用内部，点击导入或导出可选择系统文件位置；跨设备可使用同一 GitHub 数据目录手动存档和读档。卸载应用会清除本机数据，请先存档或导出。安装和更新由 Android 系统确认。详见 [Android 与 DeX 适配说明](docs/android.md)。

## GitHub 全局云存档

入口在全局「项目库 → 云存档」，每个存档包含软件的**全部项目**，并可填写名称和备注。手动新建、覆盖、读取或删除存档；项目编辑页没有同步按钮，也不会自动比较版本、选择上传下载或合并。

读取会用存档替换整个本机项目库，包含移除本机多出的项目；确认前展示项目清单，不会先保存未保存改动或生成本机读档备份。已移除旧版云端项目合集，只显示手动创建的整库存档。

沿用私有仓库的 Fine-grained Token（Contents 读写权限）和默认目录 `xuxian/projects/`，与其他软件使用独立目录。凭据保存在 Windows 凭据管理器或 Android Keystore，不进入存档。详细语义、50 MB 上限与格式见 [云存档说明](docs/github-sync.md)。

## 对白每行字符上限

电脑版「更多 → 项目设置」，手机「设定 → 项目设置」。每个项目独立设置，默认 0（不限），可设 1–500，并选择自动插入换行或仅提示超出。中文、字母、标点和完整 emoji 各计 1 个字符；描述、笔记和选项标题不受限制。

自动换行保留原有换行，不截断文字；输入法确认后再处理，可选择整理已有对白并撤销。设置写入项目 JSON v4，随另存、复制、导入导出和整库云存档保留，不影响其他项目。保存项目后设置才写入源文件。

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
