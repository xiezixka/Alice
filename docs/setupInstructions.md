If you downloaded Alice setup files from git releases, you can see some OS warnings when running the setup.

There is nothing to be afraid of; the reason for these warnings is the missing paid code signing certification that Apple and Microsoft want from developers.

Follow these simple instructions to run the setup.

## 🪟 Windows, run an unsigned app

If you see Windows standard warning that the app publisher is unknown, click 'More info' and 'Run anyway'.

## 🍎 MacOS, run an unsigned app

Run in your terminal `xattr -cr "/Applications/Alice AI App.app"`

## Building installers from source

The packaged app contains native voice assets, so build each installer on the
same operating system that will run it:

```bash
# macOS
npm run build:mac

# Windows (run in PowerShell or cmd)
npm run build:win

# Linux
npm run build:linux
```

The commands fail fast when invoked on the wrong OS. This is deliberate: a
cross-OS Electron build can finish while silently bundling unusable ffmpeg,
Whisper or Piper binaries, which would break local voice monitoring or TTS on
the target computer.

After a build, verify that electron-builder produced the actual installer
before sharing it:

```bash
# Run on the matching operating system
npm run verify:release -- macos   # release/<version>/*.dmg + *.zip
npm run verify:release -- windows # release/<version>/*.exe
npm run verify:release -- linux   # release/<version>/*.AppImage
```

The GitHub Actions build and PR workflows run this check automatically. It
rejects missing, empty, or mis-versioned installer files before they are
uploaded as downloadable artifacts.

### macOS 原生语音资源检查

打包前可以单独检查随安装包带入的 FFmpeg、Whisper 和 Piper 资源：

```bash
# 警告模式：发现历史缓存或架构问题时给出明确提示，但不阻断本地开发
npm run verify:native -- macos

# 发布前严格模式：缺失、架构不匹配或链接到 Homebrew 的资源会失败
npm run verify:native:strict -- macos
```

当前仓库的旧版构建脚本仍会从 Evermeet 下载 macOS FFmpeg；该下载是
x86_64，不能在 Apple Silicon 上原生运行。检查器会把这种情况标为
“架构不匹配”，不会再让它悄悄通过发布验收。macOS ARM 版 Piper 目前是
调用系统 Python 的脚本包装器，不是自包含的原生可执行文件；首次使用本地
TTS 可能需要先安装 Python `piper-tts`。这两项限制在找到经过许可证、依赖和
架构三重核验的固定版本前都应保留在发布说明中。

开发机临时使用语音转写时，可按 Homebrew 官方方式安装 FFmpeg（例如
`brew install ffmpeg`），并确认 `~/.local/bin` 与系统 PATH 顺序；但不要把
Homebrew 的动态库路径直接打进交付安装包。正式发布必须使用固定版本、带
SHA-256 校验且只依赖 macOS 系统库的 ARM64/Universal 构建，并在严格模式
通过后再上传产物。

# AI Provider Setup

Alice supports OpenAI, OpenRouter, DeepSeek, MiniMax, Z.ai, and local LLM inference.

## OpenAI (Default)

- Go to [OpenAI Platform](https://platform.openai.com/api-keys)
- Get OpenAI API key and add it to settings
- You might need to [verify your organization](https://platform.openai.com/settings/organization/general) for image generation
- Supports GPT models with image generation, TTS, and STT

## OpenRouter (Alternative)

- Go to [OpenRouter Platform](https://openrouter.ai/keys) to get your OpenRouter API key
- Access to 400+ models from various providers including Claude, Llama, Gemini, and more
- Set up either OpenAI speech to text or use built-in local voice generation
- Models automatically include web search capabilities
- No image generation support (use OpenAI provider for image-gen)

## DeepSeek (Alternative)

- Go to [DeepSeek API Platform](https://platform.deepseek.com/api_keys) to get your DeepSeek API key
- Select "AI Provider" in Core Settings as DeepSeek
- Use the default base URL `https://api.deepseek.com`
- DeepSeek powers chat inference only; cloud TTS/STT/embeddings still require OpenAI or local voice and memory mode
- No image generation support (use OpenAI provider for image-gen)

## Local Ollama / LM studio

- Run Ollama or LM studio
- Select "AI Provider" in Core Settings as Ollama or LM studio and Base URL (ex. `http://localhost:11434`)
- In AI tab hit "Refresh Models" and select preferred model from the list
- Select a model for summarization
- Optional but highly recommended - activate Web search tool by using Tavily or SearXNG and add corresponding API keys and base URLs
- No image generation support (use OpenAI provider for image-gen)

# Groq STT setup (optional)

- Go to [Groq cloud console](https://console.groq.com/home) and set up your account
- Get your API key from [API keys](https://console.groq.com/keys) section and paste it in settings

# Background voice listening (optional)

- Select **本地（Go 后端）** as the STT provider and enable **启用唤醒词**.
- In the same section, enable **后台语音监听**. Alice keeps the VAD microphone session alive while the window is hidden in the system tray and only sends audio for processing after the wake word is detected.
- For Chinese conversations, keep the local STT language set to **中文** and select **本地 TTS → zh_CN-huayan-medium** for the bundled Chinese female voice. The macOS installer includes this Piper model; other voices can still be selected from the voice list.
- The current installer includes the multilingual **Whisper Base** model for local STT. The model selector is intentionally fixed to Base; Tiny/Small/Medium/Large are not downloaded or activated by this build.
- Use **检查麦克风** before enabling the feature to request permission explicitly and verify the audio device; the temporary test stream is released immediately after the check.
- The setup panel also provides direct shortcuts for **麦克风**, **屏幕录制**, and **辅助功能** permissions when the corresponding desktop tools are enabled. If the operating system rejects microphone access, Alice now pauses the background session instead of continuing to display a misleading listening state.
- You can also enable **开机启动 Alice**. The next login starts Alice automatically; when background listening is enabled, the avatar starts hidden.
- This is a transcript-based wake-word flow, not a dedicated low-power keyword engine. Alice must remain running and the operating system must grant microphone permission.

Before enabling it, grant the normal desktop permissions for your platform:

- **macOS**: System Settings → Privacy & Security → Microphone. If you use
  `desktop_action`, also allow **Accessibility** for Alice.
- **Windows**: Settings → Privacy & security → Microphone → allow desktop apps
  to access the microphone. Desktop actions may fail when the target app is
  running as administrator; run Alice at the same privilege level when needed.
- **Linux**: the browser/Electron microphone permission must be allowed; mouse
  and keyboard actions additionally require `xdotool` on X11.

# Google services connection (optional)

- In settings, click 'Connect to Google Services', authorize your Google account to connect to Alice

Continue with [tools](https://github.com/xiezixka/Alice/blob/main/docs/toolsInstructions.md) setup if not done during previous steps (optional).
