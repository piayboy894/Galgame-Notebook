# 叙线 2.0 架构

## 技术选择

本项目主要处理离线文本和图编辑，需要可靠的本地文件管理、Windows 安装和长期更新。选择 Tauri 2，利用系统 WebView 和 Rust 原生能力，避免随程序分发整套 Chromium 与 Node.js。它仍使用网页渲染技术，但运行在独立桌面窗口中，不启动外部浏览器或本地 HTTP 服务。

比较了 Electron 官方更新方案。Electron 适合需要完整 Node.js 生态或固定 Chromium 行为的应用；叙线没有这些需求。为保留已实现的调查阶段、复杂分支、排序和快捷键，保留 DOM 界面并拆分领域、界面、应用服务与平台适配，而不将全部交互重新实现为另一套 UI 框架。

## 分层

| 层 | 目录 | 责任 |
| --- | --- | --- |
| 领域 | src/domain | 新建项目、JSON v1–v4 转换、行与阶段结构，不依赖原生 API |
| 应用服务 | src/application | 更新的检查、保存、备份、下载、安装与重启状态机 |
| 界面 | src/editor、src/ui、src/styles | 路线图、脚本、项目库、对话框与事件 |
| 平台适配 | src/platform | Tauri IPC、窗口生命周期、官方签名更新插件 |
| 存储核心 | crates/story-store | 原子保存、SHA-256 冲突检查、备份、回收站、复制及迁移 |
| 原生入口 | src-tauri | 系统目录、原生文件选择器、单实例及命令注册 |
| 发布 | .github/workflows、scripts | 校验、版本同步、Windows 安装器及更新清单 |

剧本保持公开的 `.story.json` 格式；格式版本独立于软件版本管理；场景组和地点使用 JSON v4，旧格式读取后在保存时迁移。未来全文搜索等缓存应作为可重建索引，不替代剧本源文件。

## 数据与更新约束

1. 文件库只接受目录中的普通 JSON；拒绝绝对路径、目录穿越、保留名称与符号链接。
2. 保存先验证、比较文件哈希、备份旧内容，再通过临时文件原子替换，失败不截断原件。
3. 导入/导出路径由 Rust 中的原生对话框选择，页面没有任意路径写入命令。
4. 更新采用 Tauri 官方插件，HTTPS 清单固定到本仓库 Releases，安装包必须通过内置公钥验证。
5. 安装前保存当前剧本并快照整个项目库，剧本目录独立于安装目录。
6. 默认离线，不后台检查、不加载远程脚本或统计；关闭窗口前处理未保存改动。

## 官方参考（2026-11-14 查阅）

- [Tauri 架构](https://v2.tauri.app/concept/architecture/)
- [Tauri 更新签名](https://v2.tauri.app/plugin/updater/)
- [Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)
- [GitHub 发布流水线](https://v2.tauri.app/distribute/pipelines/github/)
- [Electron 更新方案](https://www.electronjs.org/docs/latest/tutorial/updates)
