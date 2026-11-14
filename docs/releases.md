# 发布维护

下载入口：<https://github.com/piayboy894/Galgame-Notebook/releases/latest>。

更新清单：`https://github.com/piayboy894/Galgame-Notebook/releases/latest/download/latest.json`。安装器、签名与清单应作为同一稳定版 Release 的资产发布。

## 签名

源码只包含公钥。维护者应安全备份对应私钥，不能将其提交源码或上传公开 Release。现有安装信任这把公钥；丢失私钥就不能继续向它们发布可信更新。

在仓库 Settings → Secrets and variables → Actions 配置：

- `TAURI_SIGNING_PRIVATE_KEY`：Tauri 私钥文件完整内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：若私钥有密码则配置，否则留空。

GitHub App 没有 Secrets 管理权限时，由仓库所有者配置。不降低签名验证要求。

## 常规发布

1. 在 `package.json` 增加稳定版本号，例如 `2.1.0`。
2. 运行 `npm run version:sync`，同步前端、原生版本和对应锁文件。
3. PR 通过前端、领域、存储及 Windows 检查后合并 main。
4. `Publish Windows release` 构建并签名安装器，发布版本及 `latest.json`；也支持手动运行。
5. 验证公开下载、更新清单及上一版本的检测/安装行为。

未配置签名 Secret 时，发布工作流明确失败，不发布无效更新包。

## 本地发布

也可由维护者在 Windows 设置上述环境变量，运行测试及 `npm run desktop:build`，将 `src-tauri/target/release/bundle/nsis/` 的安装器与 `.sig` 发布至 Release，并生成 Tauri v2 格式 `latest.json`。Windows x64 的平台键为 `windows-x86_64`。程序有变化必须增加版本号，以供已安装用户检测。

已构建签名包后，也可执行 `npm run release:publish -- 安装器路径`。脚本校验版本及 main 源码树，先创建包含安装器、签名、更新清单和 SHA-256 的草稿 Release，再发布。脚本只读取公开签名文件，不读取或上传私钥。
