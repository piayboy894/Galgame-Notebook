# GitHub 剧本同步

## 配置与使用

叙线 2.2 使用私有 GitHub 仓库保存剧本，每个项目一个 JSON。默认分支为 `main`，默认目录为 `xuxian/projects/`，文件名使用项目 ID，改名后仍同步同一文件。其他软件可共用同一仓库，使用不同目录；叙线只读写配置目录中的剧本。

1. 新建私有仓库，勾选 README，确保已有 `main` 分支。
2. 在编辑器「更多 → GitHub 同步设置」填写仓库、分支和数据目录。
3. 创建 Fine-grained Token：Resource owner 选仓库所有者，Repository access 选 Only select repositories，仅选数据仓库；在 Repository 权限添加 Contents 并设为 Read and write，Metadata 保持 Read-only，Account 权限留空。
4. 令牌只填进软件，点击「验证并保存」。此步骤验证仓库可访问、分支存在且为私有；写权限在实际提交时由 GitHub 校验。
5. 点击顶部「一键同步」。程序先保存本地，再比较版本，按需上传或拉取。内容相同时不创建提交。

设置窗口的「打开预填授权页」会预填所有者、令牌名和 Contents 写权限；仍需在 GitHub 页面选择具体仓库。选中 Only select repositories 后未出现仓库选择控件时，可切换选项后重选、强制刷新或换浏览器窗口重试。

换设备后，在项目列表点击「GitHub 数据」，添加同一仓库、分支和目录，并在新设备填写令牌。选择文件，预览项目名称后点击「恢复到本地」。恢复后已关联同步目标；本地已有同 ID 项目时，打开已有项目并同步。

## 凭据与目录

- 剧本仍使用 JSON v4，兼容读取 v1–v3；角色、地点、场景组和备注随源文件同步。
- Windows 的 Token 保存在本机凭据管理器，Android 使用 Keystore 密钥加密存入应用私有目录，不回显已保存的令牌，不写入剧本、localStorage、设置 JSON 或日志。复制、另存和导出均不携带令牌或同步关联。
- 仓库、分支、目录、共同版本内容摘要和时间保存在本机应用配置目录 `github-sync/settings.json`，不上传。
- GitHub 将 Token 权限限制到仓库；文件夹范围由叙线约束。其他软件应使用各自的目录和凭据项。
- 新设备单独配置凭据。可以断开项目，或同时移除连接的本机令牌；移除令牌会影响本机复用该连接的项目。
- 启动和普通保存不自动联网。仅在用户点击验证、同步、预览或恢复时联网，失败可重试，本地文件继续可用。
- 每次同步和恢复重新检查仓库可见性，变为公开时停止。

## 冲突规则

比较本地、远端和上次成功同步的共同版本，忽略 JSON 排版和 `updatedAt`，其余字段均参与比较。

| 状态 | 行为 |
| --- | --- |
| 首次同步，远端无文件 | 上传当前本地文件 |
| 双方内容相同 | 标记成功，不创建提交 |
| 只有本地改变 | 上传，附带当前远端 SHA |
| 只有远端改变 | 自动备份本地，再拉取远端 |
| 双方改变，或首次连接到不同内容 | 等待选择；保留本地时先将远端另存为本地冲突副本，使用远端时先备份本地 |
| 曾同步的远端文件被删除 | 提示删除，需明确选择重新上传；不会自动重建或删除本地 |
| 确认期间任一侧改变 | 停止并重新检查，不强制覆盖 |

远端版本、项目 ID 或格式校验失败时停止。恢复前预览并校验完整剧本，恢复时重新比较 SHA。下载沿用原子替换和自动备份，上传使用 Contents API 的 SHA 校验，提交历史可追溯。文件沿用 25 MB 上限，大于 1 MB 的远端文件通过 raw media type 读取并校验 Git blob SHA。目录达到 GitHub 的 1000 项上限时提示另选目录。

同步不传播删除，不自动合并 JSON，也不替代本地备份。多台设备轮流编辑时，先同步再写作，写完后再同步。

## 架构与验证

- `crates/github-sync`：HTTP、版本比较、目录限制和关联存储；凭据与传输可注入测试。
- `src-tauri/src/github_sync.rs`：系统凭据、后台任务和本地存储适配。
- `src/application/sync-service.ts`：保存、检查、校验、冲突选择和执行状态机。
- `src/editor/github-sync.js`：项目配置、同步及恢复界面。

测试覆盖认证、编码、SHA 条件更新、错误脱敏、双方保留、外部改动、远端删除、恢复、路径限制和令牌隔离。

参考：[GitHub Contents API](https://docs.github.com/en/rest/repos/contents)、[令牌和预填参数](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[系统凭据存储](https://docs.rs/keyring/3.6.3/keyring/)。
