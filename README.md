# Alice

<img src="https://img.shields.io/github/license/xiezixka/alice"> <img src="https://img.shields.io/github/v/release/xiezixka/alice"> <img src="https://img.shields.io/github/downloads/xiezixka/Alice/total">

Say "Hi" to Alice 👋, your open-source AI companion designed to live on your desktop.

Alice brings together voice interaction, intelligent context awareness, powerful tooling, and a friendly personality to assist you with everything from daily tasks to deeper creative work.
Alice is more than a chatbot; she’s built to feel present, responsive, emotionally engaging, and deeply useful.

## 中文版桌面智能体

这是面向中文用户的 Alice 二次开发版本：默认使用简体中文、中文女声和中文唤醒词，支持 macOS、Windows 和 Linux 桌面端。它可以在用户授权后读取屏幕、操作应用、整理文件、规划日程，并通过 Google 日历/Gmail 或已打开的聊天应用协助处理消息。

语音链路可以完全在本机运行：VAD 负责检测说话，Go 后端的 Whisper 负责语音转文字，Piper 负责中文语音播报。语音片段会先经过前后端能量门控，静音不会被送进 Whisper，避免静音幻觉触发指令。后台唤醒是显式开关：开启“后台语音监听”并授权麦克风后，Alice 隐藏到系统托盘仍会等待唤醒词；未开启时不会占用麦克风。

桌面写操作默认需要逐次确认。文件整理先生成预览，执行后提供撤销 ID；屏幕截图只作为当前视觉请求的临时上下文，不写入长期聊天记录。微信、QQ、Slack 等没有内置账号接口时，可先观察已打开会话，再用 `desktop_reply_message` 在一次确认中核对收件人和正文后发送；不会声称能在后台读取或发送消息。

## Quick showcase

<p align="center">
  <a href="https://www.youtube.com/watch?v=fDYUjh6UXqk">
    <img width="817" height="504" alt="AliceVideo" src="https://github.com/user-attachments/assets/9e0ffee2-198a-43a0-9f9a-a003d221e31d" />
  </a>
</p>

## ✨ Key Features

### 💻 Local and Cloud use

Alice is designed to work with Cloud(OpenAI / Codex subscription, OpenRouter, Z.ai, Minimax, Deepseek) and Local LLMs (Ollama/LM Studio).
Has built-in speech-to-text, text-to-speech, and embedding services.
While the OpenAI cloud API is preferred and provides the best user experience, Alice can also operate **fully locally** (experimental).

### 🗣️ Voice Interaction

- Fast, VAD-powered voice recognition via cloud STT or the bundled local Go/Whisper backend
- The current desktop bundle ships the multilingual Whisper Base model for local STT; larger model choices are intentionally disabled until download, storage, and resource checks are implemented
- Natural-sounding responses with OpenAI/Google TTS and optional support for local multilingual text-to-speech via Piper TTS (the Chinese build defaults to the female `zh_CN-huayan-medium` voice)
- Interruptible speech and streaming response cancellation for smoother flow

### 🧠 Memory & Context

- **Thoughts**: Short-term context stored in Hnswlib vector DB
- **Memories**: Structured long-term facts in local DB
- **Summarization**: Compact message history into context prompts
- **Emotion awareness**: Summaries include mood estimation for more human responses
- **Local RAG**: Add local documents to the LLM context, chat with your docs

### 🎨 Vision & Visual Output

- Screenshot interpretation using Vision API
- Image generation using `gpt-image-2`
- Animated video states (standby/speaking/thinking)

### 🪄 Computer Use Tools

Alice can interact with your local system with user-approved permissions:

- 📂 File system browsing (e.g., listing folders)
- 💬 Safe replies in an already-open chat: `desktop_observe` binds the
  foreground window, then `desktop_reply_message` shows the recipient/body in
  one confirmation before typing and sending; no background chat access
- 💻 Shell command execution (`ls`, `mv`, `mkdir`, etc)
- 🔐 Granular command approvals:

  - One-time
  - Session-based
  - Permanent (revocable)

- 🔧 Settings tab "Permissions" lets you review and manage all approved commands

### ⚙️ Function Calling

- Web search (including Searxng support)
- Google Calendar & Gmail integration
- Torrent search & download (via Jackett + qBittorrent)
- Time & date awareness
- Clipboard management
- Task scheduler (reminders and command execution)
- Open applications & URLs
- Image generation
- MCP server support

### 💬 Wake Word Support

With the local STT model, you can set a **wake-up word** (like "Hey, Siri").

- 自定义唤醒词支持中文、英文或混合短语，保存时会统一 Unicode 格式并合并多余空格；唤醒词最多 40 个字符，仅含空白、纯标点或控制字符的值会被拒绝（清空输入则表示关闭唤醒词门控）。
- When **后台语音监听** is enabled, Alice keeps the local VAD session active while hidden in the system tray. VAD segments are transcribed locally, but only a transcript that matches the wake word is forwarded as an assistant command.
- Default mode is **auto language detection**, but you can also select a specific language in settings.
- In **Core Settings**, enable **后台语音监听** to keep VAD active while the avatar is hidden in the system tray. This requires local STT + wake word mode; closing the avatar hides it instead of quitting, and **退出 Alice** remains available from the tray menu.
- **开机启动 Alice** uses the operating system login-item mechanism. When paired with background listening, Alice starts hidden and waits for the wake word.
- 修改唤醒词后点击“保存并重新加载”即可生效；如果后台监听已开启，重启会继续携带后台启动参数并保持窗口隐藏，手动打开 Alice 仍会显示主窗口。
- 后台唤醒基于本地 Whisper 转写和 VAD，并非低功耗专用关键词芯片；Alice 进程必须保持运行且系统必须授予麦克风权限。

### 中文快速启用

1. 在 **设置 → 核心设置** 选择 DeepSeek，并填写 API Key；默认模型为 `deepseek-v4-flash-vision-exp`。
2. 将语音识别切换为 **本地（Go 后端）**，启用唤醒词并设置为 `alice`。
3. 点击“检查麦克风”，在系统权限提示中允许 Alice 使用麦克风。
4. 打开“后台语音监听”并保存，然后隐藏窗口到托盘。
5. 说“爱丽丝，请打开日历”进行测试。需要操作桌面时，再按提示授予辅助功能和屏幕录制权限。

API Key、Google 授权和系统权限都不会由安装程序代替用户授予；没有这些授权时，Alice 会明确提示缺少的能力，而不会伪称操作已经完成。

### 💻 Dedicated Chrome [Extension](https://github.com/pmbstyle/alice-chrome-extension)

- Ask Alice about your active Chrome tab
- Context menu for selected text on a web page
  - Fact check this
  - Summarize this
  - Tell me more about it

### 🎛️ Flexible Settings

Fully customizable settings interface:

- LLM provider selection between OpenAI, OpenRouter, DeepSeek, Z.ai(coding plan), Minimax(token plan), Ollama, LM Studio
- Cloud or local TTS, STT, Embeddings
- Model choice & parameters (temperature, top\_p, history, etc)
- Prompt and summarization tuning
- Audio/mic toggles & hotkeys
- Switchable main-window styles: **悬浮胶囊** (A) and **玻璃对话卡片** (B); use the toggle in the top-right corner or **Settings → AI 助手 → 主界面样式**.
- macOS 可选 **静默灵动岛**：最小化后自动收纳到当前屏幕顶部中央的 240×44 窄胶囊；待命/后台等待唤醒词时约 2.2 秒后自动收起，开始处理或播报会立即展开。点击胶囊或按 Enter/空格可恢复完整窗口；在 **设置 → AI 助手** 关闭后恢复原来的 210×210 小窗（Windows/Linux 不受影响）。这是基于屏幕顶部安全区的跨版本布局，不依赖特定机型的物理灵动岛 API。
- Available tools & MCP configuration
- Google integrations

### 🔨 Custom Tools

Alice supports [custom tools](https://github.com/xiezixka/Alice/blob/main/docs/custom-tools.md) that are defined in JSON and backed by local scripts.

1. Open _Settings → Customization → Custom tools_
2. Upload or drop your script (writes to `custom-tool-scripts/`)
3. Click **Add Tool**, fill in metadata, and paste the JSON schema. Saving updates `custom-tools.json`
4. Toggle the tool on/off in the list. Only enabled + valid entries are offered to the model.

### 🎭 Custom Avatars

Swap Alice's appearance with [your own](https://github.com/xiezixka/Alice/blob/main/docs/custom-avatars.md) video loops:

1. Create a folder under `user-customization/custom-avatars/<AvatarName>/`.
2. Drop `speaking.mp4`, `thinking.mp4`, and `standby.mp4` into that folder (all required).
3. Open **Settings → Customization → Assistant Avatar**, hit **Refresh**, and pick the new avatar.

## 🚀 Download

👉 **[Download the latest stable release](https://github.com/xiezixka/Alice/releases/latest)** (when one has been published)

For fork builds, use the [Build and Release workflow](https://github.com/xiezixka/Alice/actions/workflows/build.yml). Run it with **Create a GitHub release** disabled, then download the platform artifact from the completed run. Manual artifacts are retained by GitHub for five days.

<!-- STABLE_DOWNLOADS -->

| Platform                       | Download                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| **Windows**                    | `release-artifacts-windows-latest` from the completed workflow run |
| **macOS**                      | `release-artifacts-macos-latest` from the completed workflow run   |
| **Linux**                      | `release-artifacts-ubuntu-latest` from the completed workflow run  |
| **ArchLinux**(community build) | [AUR Package](https://aur.archlinux.org/packages/alice-ai-app-bin) |

<!-- STABLE_DOWNLOADS_END -->

Follow the [Setup Instructions](https://github.com/xiezixka/Alice/blob/main/docs/setupInstructions.md) to configure your API keys and environment.

## 🛠️ Technologies Used

- **Frontend:** [Vue.js](https://vuejs.org/), [TailwindCSS](https://tailwindcss.com/)
- **Desktop Shell:** [Electron](https://www.electronjs.org/)
- **State Management:** [Pinia](https://pinia.vuejs.org/)
- **AI APIs:** [OpenAI](https://platform.openai.com/), [OpenRouter](https://openrouter.ai/), [DeepSeek](https://platform.deepseek.com/), [Groq](https://console.groq.com/)
- **Backend:** [Go](https://go.dev/)
- **Vector search engine**: [hnswlib-node](https://github.com/nmslib/hnswlib)
- **Local storage**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Voice activity detection:** [VAD (Web)](https://github.com/ricky0123/vad)
- **Local STT & TTS:** [whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) & [Piper](https://github.com/rhasspy/piper)
- **Local Embeddings:** [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (ONNX, 384 dimensions)
- **Animation:** [Kling Pro](https://fal.ai/)

Other tools:

- [Jackett](https://github.com/Jackett/Jackett) — Torrent aggregator
- [qBittorrent](https://www.qbittorrent.org/) — Torrent client
- [Searxng](https://github.com/searxng/searxng) - Self-hosted web search

## 🧑‍💻 Getting Started (Development)

```bash
# 1. Clone the repo
$ git clone https://github.com/xiezixka/Alice.git

# 2. Install dependencies
$ npm install

# 3. Set up your .env file (see .env.example for reference)
```

Follow [setup instructions](https://github.com/xiezixka/Alice/blob/main/docs/setupInstructions.md) to obtain required API credentials.

```bash
# 4. Download ONNX Runtime and the pinned multi-lang Memory/RAG model
npm run setup:embeddings

# 5. Compile backend
npm run build:go

# 6. Run dev environment
$ npm run dev
```

### 📦 Production Build

Optionally, create an `app-config.json` file in the root directory for Google integration:

```json
{
  "VITE_GOOGLE_CLIENT_ID": "",
  "VITE_GOOGLE_CLIENT_SECRET": ""
}
```

```bash
# Build the app
$ npm run build
```

Install the output from the `release/` directory.

For a release build, use the command for the operating system you are
currently running:

```bash
# macOS (DMG installer + ZIP updater package)
npm run build:mac

# Windows (NSIS installer, x64)
npm run build:win

# Linux (AppImage, x64)
npm run build:linux
```

Each installer must be built on its native operating system. Alice bundles
platform-specific ffmpeg, Whisper and Piper binaries for local voice listening
and speech output; the release commands intentionally stop early on a
different OS instead of producing an installer with broken voice features.
GitHub Actions builds the three native installers on macOS, Windows and Linux.

在 macOS 上发布前还应执行 `npm run verify:native:strict -- macos`。它会检查
FFmpeg/Whisper 的架构，并拒绝链接到开发机 Homebrew 路径的二进制；警告模式
`npm run verify:native -- macos` 适合日常开发。当前旧版 FFmpeg 下载源只提供
x86_64，Apple Silicon 构建会明确报告架构不匹配；ARM Piper 仍是依赖系统
Python 的包装脚本。临时开发可按需 `brew install ffmpeg`，但正式安装包不能
依赖用户机器上的 Homebrew 动态库，需换成经过许可证、依赖和 SHA-256 核验的
固定 ARM64/Universal 资源后再发布。

## 🤝 Contributing

Ideas, bug reports, feature requests - all welcome! Open an issue or PR, or drop by to share your thoughts. Your input helps shape Alice into something wonderful 💚

## A full app overview with tutorials

<p align="center">
  <a href="https://www.youtube.com/watch?v=aFTjmTRTLUM">
    <img width="846" height="475" alt="image" src="https://github.com/user-attachments/assets/432211d2-d820-437d-9541-8cedbba1f770" />
  </a>
</p>
