# 手机、三星平板与键鼠交互（2.4）

本轮约束：对白必须在脚本列表内直接编辑，不增加逐行编辑二级页面；手机 App 显示名只用「叙线」；云存档是全部项目的全局功能，不能出现在单个项目编辑页。

## 窗口与输入分开处理

- 小于 600 CSS px：底部「大纲／写作／设定／项目」导航、顶部上下文和保存入口，新增对白／描述在底部。阶段通过选择面板切换。
- 600 px 及以上：侧边导航和直接编辑工作区。平板、DeX 以及窄分屏按可用窗口宽度适配，不按型号或 User Agent 判定。
- 始终保留 Android 触控目标尺寸。触屏、鼠标和键盘可交替使用；有触摸屏不代表每次输入都是触摸。不会在按下鼠标时突然缩放控件，避免目标在手指／鼠标按下后移位。
- 普通窗口缩放只改布局，不重建脚本 DOM，保留正在编辑的值、焦点与文字选择。路线图／章节列表可随窗口空间切换。

## 列表内连续写作

- 对白和描述都是列表里的真实输入框，点文字即可编辑。表情和动作按行展开，不弹出另一页。
- 软键盘显示时隐藏手机底部导航和次要栏，提供上一行、下一行、下方新增对白、收起键盘。IME 状态由 Android 原生 Insets 报告；物理键盘和低高度 DeX 窗口不会被误判成软键盘。
- Enter 保留换行，输入法组合输入／候选确认不触发编辑命令；文本输入框保留系统文字选择与右键菜单。
- 触屏滚动不启动行拖动。触屏通过行号多选、菜单上移／下移；鼠标仍可拖动排序。连续行可点击建组或使用 Ctrl+G。

## 操作菜单与键盘

- 触屏在紧凑窗口使用底部操作面板。多级操作替换面板内容并提供返回，不使用向左右飞出的桌面级联菜单。
- 鼠标保留定位到指针／按钮的右键菜单、Ctrl 增减选择、Shift 连续选择。
- Tab 有可见焦点；Shift+F10 可打开选中行菜单。保留 Ctrl+S/O/K/G/Z、复制粘贴及 Alt+Enter，应用内和系统快捷键助手提供说明。
- 返回先处理软键盘、最上层菜单、对话框与多选，再逐级返回阶段、章节、大纲和项目库，根界面返回后台。

## 验证范围

自动化覆盖行内输入、字段展开、11 种窗口大小切换及焦点／光标保留、软键盘工具栏、触屏面板返回层级、触摸屏存在时的鼠标右键与多选、键盘建组和快捷键、草稿恢复。Android 模拟器另外验证真实 IME、系统快捷键、文件选择器和 Activity 重建。三星实体设备的厂商键盘、分屏与 DeX 行为仍需真机验收。

## 设计依据（2026-11-15 查阅）

- [Android 自适应导航](https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation)：紧凑窗口使用底部导航，宽窗口提供导航栏。
- [Android 自适应应用质量](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality)：窗口大小、键盘、鼠标、触控板和触控输入应分别适配。
- [Android 无障碍触控尺寸](https://developer.android.com/guide/topics/ui/accessibility/apps)：触控目标至少 48 dp。
- [Android 键盘输入](https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input/commands)：保留原生文字编辑与键盘输入语义，不依赖软键盘一定发送按键事件。
- [Android 底部面板](https://developer.android.com/develop/ui/compose/components/bottom-sheets)。
- [Samsung DeX 优化](https://developer.samsung.com/samsung-dex/modify-optimizing.html)：可调整窗口、键鼠输入及配置变化。
