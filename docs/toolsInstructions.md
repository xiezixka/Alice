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
- `capture_desktop_screen`：在用户授权后读取当前主屏幕，作为视觉模型的临时上下文；macOS 需要“屏幕录制”权限，截图不会写入长期聊天记录。
- `desktop_action`：在确认弹窗后打开应用、聚焦窗口、点击坐标、输入文本或发送快捷键。macOS 需要给 Alice 开启“辅助功能”权限；Linux 需要 `xdotool`。
- 核心设置页会根据已启用的工具提供“打开屏幕录制设置”和“打开辅助功能设置”快捷入口，完成授权后再重试对应操作。

## 文件整理

- `list_directory_detailed`、`find_files`：只读查看目录和搜索文件。
- `organize_files`：默认 `dryRun=true`，先返回变更清单；用户确认后再设置 `dryRun=false` 执行移动、复制或重命名。
- `undo_file_organization`：使用执行返回的 `operationId` 撤销最近一次整理。撤销记录保存在当前运行会话中，应用重启后失效。

## Gmail 与行程

- `create_email_draft`：创建草稿，不会发送。
- `reply_to_email`、`send_email`：发送前会显示确认弹窗；Google 连接需要重新授权 `gmail.compose` 和 `gmail.send` 权限。
- 微信、QQ、Slack 等聊天应用目前通过 `capture_desktop_screen` + `desktop_action` 辅助操作；这要求聊天窗口已打开、模型支持视觉输入，并且每次发送前都要确认收件人和正文。
- `plan_itinerary`：读取 Google 日历并生成避开冲突的时间草案，不会自动写入日历。

所有写操作都应先展示目标、影响和内容。工具失败或平台不支持时必须如实反馈，不得声称已完成。
