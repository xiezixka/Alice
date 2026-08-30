# Tools setup instruction

To activate all tools, you need to get your API credentials for each tool.

**Get your API credentials**

- `VITE_JACKETT_API_KEY`, `VITE_JACKETT_URL` from your local hosted [Jackett](https://hub.docker.com/r/linuxserver/jackett/) setup
- `VITE_QB_URL`, `VITE_QB_USERNAME` and `VITE_QB_PASSWORD` from your [Qbittorrent](https://hub.docker.com/r/linuxserver/qbittorrent) setup

**DEV only**

- `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_SECRET` from [Google Cloud](https://console.cloud.google.com/apis/credentials)

# 桌面智能体工具说明（中文扩展）

## 桌面操作

- `desktop_capabilities`：查看当前系统支持的桌面动作。
- `desktop_observe`：在用户授权后只读观察当前主屏幕，返回截图、显示器坐标元数据和短期 `observationId`。如果目标应用尚未在前台，应先用 `open_app` 或 `focus_window`，再观察；令牌会在约 30 秒后、前台窗口变化时或显示器上下文变化时失效。截图像素不会写入长期聊天记录。macOS 需要“屏幕录制”权限。
- `capture_desktop_screen`：兼容旧流程的读取入口；新版桌面桥接同样返回观察元数据和 `observationId`。新的点击、输入和快捷键流程优先使用 `desktop_observe`。
- `desktop_action`：在确认弹窗后打开应用、聚焦窗口、点击坐标、输入文本或发送快捷键。`click`、`type`、`hotkey` 必须携带刚刚观察得到的 `observationId`；截图像素坐标需要传 `coordinateSpace: "image"`，主进程会根据显示器位置和缩放映射到真实屏幕。令牌过期或上下文变化时，操作会中止并要求重新观察。执行后会尽量返回新的屏幕观察供模型验证。Windows 文本输入使用 Unicode `SendInput`，可稳定输入中文、emoji 和多行内容；macOS 需要给 Alice 开启“辅助功能”权限；Linux 需要 `xdotool`。
- `desktop_reply_message`：用于回复已经打开的聊天会话。先通过 `desktop_observe` 确认会话和收件人，再传入同一个 `observationId`、模型识别出的 `recipient` 与拟发送 `body`；可选 `expectedApp`/`expectedWindowTitle` 会进一步绑定目标窗口。系统会在一次确认弹窗中同时展示目标应用、收件人、正文和发送快捷键，然后输入并发送，最后尽量返回新的截图复核。默认使用 `ENTER`，也支持 `CTRL+ENTER`、`CMD+ENTER`。令牌失效、窗口变化或用户取消时不会发送；该工具不读取或操作后台未打开的聊天。
- 观察令牌不会绕过权限或确认：它只证明“执行时的桌面上下文仍与模型刚刚看到的一致”。
- 核心设置页会根据已启用的工具提供“打开屏幕录制设置”和“打开辅助功能设置”快捷入口，完成授权后再重试对应操作。

## 文件整理

- `list_directory_detailed`、`find_files`：只读查看目录和搜索文件。
- `organize_files`：默认 `dryRun=true`，先返回变更清单；用户确认后再设置 `dryRun=false` 执行移动、复制或重命名。
- `undo_file_organization`：使用执行返回的 `operationId` 撤销最近一次整理。最近 50 次已确认的操作会保存到 Alice 用户数据目录，应用重启后仍可撤销；如果磁盘不可写，工具会明确返回警告。

## Gmail 与行程

- `create_email_draft`：创建草稿，不会发送。
- `reply_to_email`、`send_email`：发送前会显示确认弹窗；Google 连接需要重新授权 `gmail.compose` 和 `gmail.send` 权限。
- “助手配置 → 启用邮件工具”会一次加入未读邮件、搜索、读取和 Gmail 回复工具；回复仍需在弹窗中核对并确认。
- 微信、QQ、Slack 等聊天应用目前优先通过 `desktop_observe` + `desktop_reply_message` 辅助操作；聊天窗口必须已打开且处于前台，模型支持视觉输入，并且每次发送前都要确认收件人和正文。若高层工具不可用，才使用 `desktop_action` 分步操作。Alice 不会在后台读取或发送未打开的聊天。
- `plan_itinerary`：读取 Google 日历并生成避开冲突的时间草案，不会自动写入日历。

所有写操作都应先展示目标、影响和内容。工具在执行时还会再次校验助手设置中的启用状态；即使模型返回了未启用的工具调用，也会拒绝执行。工具失败或平台不支持时必须如实反馈，不得声称已完成。
