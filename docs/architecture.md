# 叙线架构

## 技术选择

本项目主要处理离线文本和图编辑，需要可靠的本地文件管理、Windows 与 Android 安装和长期更新。选择 Tauri 2，利用系统 WebView 和 Rust 原生能力，避免随程序分发整套 Chromium 与 Node.js。它使用网页渲染技术，运行在独立应用中；发布版不启动外部浏览器或本地 HTTP 服务。

比较了 Electron 官方更新方案。Electron 适合需要完整 Node.js 生态或固定 Chromium 行为的应用；叙线没有这些需求。为保留已实现的调查阶段、复杂分支、排序和快捷键，保留 DOM 界面并拆分领域、界面、应用服务与平台适配，而不将全部交互重新实现为另一套 UI 框架。

## 分层

| 层 | 目录 | 责任 |
| --- | --- | --- |
| 领域 | src/domain | 新建项目、JSON v1–v4 转换、行与阶段结构，不依赖原生 API |
| 应用服务 | src/application | 软件更新与 GitHub 数据同步状态机，协调保存、检查、冲突处理和执行 |
| 界面 | src/editor、src/ui、src/styles | 路线图、脚本、项目库、对话框与事件 |
| 平台适配 | src/platform | Tauri IPC、平台识别、生命周期和更新端口 |
| 存储核心 | crates/story-store | 原子保存、SHA-256 冲突检查、备份、回收站、复制及迁移 |
| 数据同步 | crates/github-sync | GitHub Contents API、共同版本比较、SHA 校验、目录约束和项目关联；凭据由原生层注入 |
| 原生入口 | src-tauri | 系统目录、命令注册；桌面单实例；Android 草稿、文件选择器、Keystore 和安装器桥接 |
| 发布 | .github/workflows、scripts | 版本同步、双平台构建及签名；安装包齐备后发布 |

剧本保持公开的 `.story.json` 格式；格式版本独立于软件版本管理；场景组和地点使用 JSON v4，旧格式读取后在保存时迁移。未来全文搜索等缓存应作为可重建索引，不替代剧本源文件。

## 数据与更新约束

1. 文件库只接受目录中的普通 JSON；拒绝绝对路径、目录穿越、保留名称与符号链接。
2. 保存先验证、比较文件哈希、备份旧内容，再通过临时文件原子替换，失败不截断原件。
3. 导入/导出由原生文件选择器选择，Android 使用 Storage Access Framework；页面没有任意路径写入命令。
4. Windows 更新采用 Tauri 官方插件；Android 在 Rust 校验版本、SHA-256 和 Minisign 后交给系统安装器。HTTPS 清单固定到本仓库 Releases，安装包必须通过内置公钥验证；Android 另由系统验证固定 APK 证书。
5. 安装前保存当前剧本并快照整个项目库，剧本目录独立于安装目录。
6. 默认离线，不后台检查、不加载远程脚本或统计；桌面关闭窗口前处理未保存改动，Android 生命周期切换时写入原生草稿。

手机、平板和 DeX 共用领域模型、编辑器及同步核心，按可用窗口宽高调整布局。Android 项目库在应用私有目录，令牌由 Android Keystore 加密；详细边界、构建与验证见 [Android 说明](android.md)。

## 官方参考（2026-11-14 查阅）

- [Tauri 架构](https://v2.tauri.app/concept/architecture/)
- [Tauri 更新签名](https://v2.tauri.app/plugin/updater/)
- [Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)
- [GitHub 发布流水线](https://v2.tauri.app/distribute/pipelines/github/)
- [Electron 更新方案](https://www.electronjs.org/docs/latest/tutorial/updates)
