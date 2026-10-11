# Run Anascummis locally

This ZIP is a source kit, not a prebuilt desktop installer. Extract it to a new folder and keep the included licenses. The application runs on your computer and opens in your browser.

## Requirements

- Bun and Python (or uv), installed separately.
- Several GB of free disk space for dependencies, CPU model and speech files. A modern 64-bit computer with 8 GB RAM is a practical starting target, not a measured minimum.
- Windows x64: model setup installs the official llama.cpp CPU runtime automatically.
- macOS, Linux and other architectures: install a compatible llama.cpp CPU build yourself. Set `LLAMA_SERVER` to the full path of its `llama-server` executable before starting the model.
- FFmpeg and FFprobe on PATH for video tools. Node and Chrome/Edge are needed for background browser capture; yt-dlp is needed for YouTube imports.

Setup needs an internet connection. Model and speech downloads can be large. Native speech and every consumer device have not been validated by this kit's packaging checks.

## Install

Open a terminal inside the extracted `studio` folder:

```sh
bun install
bun run setup
bun run model:setup
bun run speech:setup
bun run build
```

The build generates the scene and matching browser speech runtime from installed dependencies. Model weights, runtime downloads, Python environments and installed dependencies are intentionally excluded from the ZIP.

Start the CPU model in one terminal:

```sh
bun run model:start
```

In another terminal, also inside `studio`:

```sh
bun run start
```

Open **http://127.0.0.1:3211**. Keep both terminals running. Stop them with Ctrl+C. For frontend development, use `bun run dev` instead of `start`.

On macOS/Linux, set the runtime path in the model terminal first:

```sh
export LLAMA_SERVER=/absolute/path/to/llama-server
bun run model:start
```

In Windows PowerShell, if using your own runtime:

```powershell
$env:LLAMA_SERVER = 'C:\path\to\llama-server.exe'
bun run model:start
```

Copy `.env.example` to `.env` only if you need optional settings; keep credentials private. Local files, chat history, models, databases and vault data stay in your extracted application folder. The ZIP has no account credentials or personal data.

## Verify and licenses

`bun run test` runs the included tests; PDF tests require the Python environment from `bun run setup`. `bun run typecheck` checks TypeScript. The included `licenses` and `dependencies/etro` folders provide Etro's GPL-3.0 license and corresponding source. Speech installers obtain their own model/runtime licenses; see `licenses/VOICE.md`.

After models and dependencies are installed, local editing can work offline while the app and model servers are running. Research, cooperation, payments and Cloudflare publishing require network access. Never treat a source ZIP as an installed or fully device-verified executable.
