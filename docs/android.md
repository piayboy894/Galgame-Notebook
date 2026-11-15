# Android、平板和 DeX

## 设备与窗口

- 最低 Android 8.0（API 26），目标 Android 16（API 36）。APK 包含 arm64-v8a、x86_64，原生库和 APK 验证 16 KB 页兼容。
- 不锁定方向或屏幕比例；声明可缩放、最小 280×240 dp 窗口、尺寸变化支持及非必需触屏。支持多窗口、三星分屏、DeX 的鼠标和外接键盘。
- 使用窗口实际宽高，而非设备型号判断布局。600 CSS px 以下使用底部导航，默认章节列表；对白在列表内直接编辑，表情和动作行内展开。平板宽窗口提供导航栏与完整编辑字段。低高度窗口允许滚动访问内容。
- 系统状态栏、导航栏、刘海、DeX 标题栏和软键盘由原生窗口 Insets 处理；真实 IME 状态驱动键盘工具栏，不根据窗口高度猜测，内容区随窗口可用空间变化。常见方向、密度和键盘配置变化不重建 Activity。
- 触屏点击行号增减多选，选中后点建组；鼠标右键、Ctrl+G、Ctrl+S 等快捷键保留。系统返回按弹窗、菜单、阶段、章节、项目与项目库逐级处理，根界面返回后台。

## 数据

项目位于应用内部 `projects/`，使用与桌面相同的 Rust 原子保存、文件哈希冲突检测、自动备份和 JSON v4。没有申请管理全部文件或读写整个外部存储的权限。导入／导出使用系统 Storage Access Framework，可选系统文件夹、云盘提供商或外接存储。

Android 额外将编辑草稿原子保存到应用内部，启动时与 WebView 本机草稿比较恢复。会话 epoch 和递增序号阻止旧写入覆盖新草稿；WebView 重载后开启新会话。进入后台立即刷新草稿。源文件保存和全局云存档均由用户点击触发。项目库代次用于拒绝整库读档前遗留的编辑草稿。

GitHub 云存档按整个项目库手动管理，不进行三方比较或自动选择方向。整库读取直接替换本机项目及未保存改动，不先保存或生成读档备份，详见 [云存档说明](github-sync.md)。Token 经 Android Keystore 中不可导出的 AES-256-GCM 密钥加密，仅密文写 SharedPreferences，不写剧本和普通设置。新设备单独填写令牌；应用禁用自动系统备份，卸载前请先手动云存档或导出。应用升级复用签名和包名，保留本机项目与凭据。

## 安装和更新

包名固定 `io.github.piayboy894.xuxian`。使用稳定、免费生成的 APK 签名身份；系统会再次校验升级包签名。软件内检测更新读取本仓库 `android-latest.json`，下载 URL 限定本仓库版本资产，保存与备份后先验证 SHA-256、固定公钥的 Minisign 签名及签名内版本号，再打开系统安装器。首次更新可能需要在系统设置允许叙线安装应用，返回后重新点击更新即可。不会申请静默安装权限。

现有 `TAURI_SIGNING_PRIVATE_KEY` 继续用于更新包签名，并通过带独立用途标签的 HKDF-SHA256 派生包装密钥，使用随机盐和随机 IV 的 AES-256-GCM 保护独立生成的 Android PKCS12 身份。公开仓库只保留认证加密后的 `release/android-signing.enc.json` 和公有证书指纹，不含明文私钥或密码。构建通过现有 Actions Secret 解锁，解密结果仅写忽略的工作目录和 Gradle 属性文件，不传入命令参数或日志。

必须备份原发布签名私钥及加密身份文件。轮换发布 Secret 前，先在受保护环境解密并以新包装密钥重新封装同一 Android 身份；不能重新生成 APK 签名身份。解密失败、证书指纹变化或安装包缺失时，自动发布停止。Windows 和 Android 包全部准备完成后才公开同一版本。

## 开发与验收

准备 JDK 21、Android SDK platform 36、build-tools 37.0.0、NDK 28.2.13676358 和 Rust `aarch64-linux-android`、`x86_64-linux-android` 目标。生成的 Android 工程和原生 Kotlin 适配代码已纳入仓库。`npm run android:build` 构建双架构 APK；发布构建先通过 `scripts/android-signing.mjs prepare` 解锁现有身份，再由 `scripts/android-release.mjs` 验证、签名并生成清单。

验证包括原有桌面回归、手机／平板／DeX／键盘等窗口尺寸切换、触屏建组、文件适配、后台草稿、更新系统确认流程，以及 Android 模拟器中原生 Keystore、系统文件选择器和 Activity 恢复。模拟器不能代替三星真机验证；三星分屏和 DeX 的厂商行为需在实际设备上最终验收。

官方依据：[Android 多窗口](https://developer.android.com/develop/adaptive-apps/guides/support-multi-window-mode)、[方向和比例](https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability)、[Samsung DeX 优化](https://developer.samsung.com/samsung-dex/modify-optimizing.html)、[Tauri Android 插件](https://v2.tauri.app/develop/plugins/develop-mobile/)、[Android 签名](https://v2.tauri.app/distribute/sign/android/)。

手机／平板输入与交互设计依据见 [移动交互设计](mobile-interaction.md)。应用显示名称和 Activity 标题均为「叙线」。
