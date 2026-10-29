# Run this source kit locally

This is the Anascummis Studio source kit, not a prebuilt desktop installer. Extract it into a new folder, keep the licenses, and open a terminal inside `studio`. The application runs on your computer and opens in a browser.

## Identify this copy

`SOURCE-KIT.json` records the full content version, declared source commit/working-copy state, dependency versions and each payload file's SHA-256. Download displays that version and the ZIP's SHA-256. Before extracting, compare `Get-FileHash <zip> -Algorithm SHA256` in PowerShell, `sha256sum <zip>` on Linux, or `shasum -a 256 <zip>` on macOS with the displayed hash or supplied `.zip.sha256` file. A content hash identifies this copy; it is not a code-signing certificate.

The kit includes `bun.lock`, setup/build scripts, standalone `shared/types.ts`, existing licenses, and Etro 0.14.1's corresponding source in `../dependencies/etro`. It excludes installed dependencies, Python environments, caches, private data/credentials, generated runtime binaries and model weights.

## Prerequisites and measured limits

- Bun installed separately; this workflow was checked with Bun 1.3.14.
- Node 20.9 or newer: the locked Next 16.4.3 CLI requires it. The packaging check used Node 24.19.0. Node is also used by optional browser-capture tools.
- Python 3; Python 3.12.14 was checked here. `bun run setup` creates `.venv` and installs pinned PDF dependencies, using uv if available or Python's venv/pip otherwise. Other Python/runtime combinations have not been established by this extraction check.
- Connectivity for first dependency, model and speech downloads; several GB of disk space. A modern 64-bit computer with 8 GB RAM is a practical target, not a measured minimum or device guarantee.
- Optional video tools need FFmpeg/FFprobe on PATH. Browser capture needs Node and compatible Chrome/Edge; YouTube import also needs yt-dlp. See `VIDEO.md` and `.env.example`.

The bounded packaging check runs on Linux x64 with matching already installed dependencies/Python reused. It is not a fresh online installation, Windows/macOS validation, or proof of physical-phone keyboard, microphone, native Qwen or spoken-reply behavior.

## Build and open the UI

Inside `studio`:

```sh
bun install --frozen-lockfile
bun run setup
bun run build
bun run start
```

Open **http://127.0.0.1:3211** and keep the app terminal running. Stop it with Ctrl+C. The UI can open before models/voice are installed: Type a message, Goals, Work and Software remain discoverable; tasks needing inference honestly fail or request input. Opening the UI does not establish AI readiness.

The build generates scene/browser runtime files from installed dependencies and a versioned kit under `out/opensource`. Download checks this copy's same-origin manifest and archive headers before offering the file; this does not pre-download the ZIP or models. `bun run kit:build` regenerates the kit without rebuilding the UI. `bun run demo:build` copies that same build/kit into demo assets; it does not deploy. The source catalog and existing Etro license accompany the kit. Missing/invalid manifests disable the download with a retry; no unknown external version is substituted.

For frontend development use `bun run dev` instead of `start`; the backend proxies Next on port 3212. Build before expecting a corresponding source download. `bun run typecheck` checks TypeScript; `bun run test` runs included tests and needs the PDF environment for PDF cases.

## Enable local AI and voice separately

Do this only when the required providers are reachable. These commands download models/runtimes and do not replace the UI build:

```sh
bun run model:setup
bun run speech:setup
```

Windows x64 model setup obtains an official llama.cpp CPU runtime. On macOS, Linux and other architectures, install a compatible CPU llama.cpp build separately and set `LLAMA_SERVER` to its full executable path. The current model script uses one CPU inference slot, four threads and a 2048-token context; this is not general GPU/device support.

In one terminal inside `studio`, start the model:

```sh
# macOS/Linux, when using your installed runtime:
export LLAMA_SERVER=/absolute/path/to/llama-server
bun run model:start
```

On Windows PowerShell, a custom runtime can be selected with `$env:LLAMA_SERVER = 'C:\path\to\llama-server.exe'` before `bun run model:start`. The automatic Windows runtime does not need that override.

In another terminal run `bun run start`, or leave the app terminal already running. Use **Check again** to check service reachability. Model readiness only means the health check answered; voice initialization does not verify microphone capture, spoken replies or task accuracy.

If a download fails or returns 403, setup has not succeeded. Keep the failure, resolve provider/network access on that machine, and rerun the affected setup manually only after access changes. Do not discard a saved request or keep resubmitting it to test readiness. Work preserves unsuccessful requests for **Edit saved request** and an explicit new attempt; Goals/Software keep separate continuation controls. Download/Check again never automatically replay a task or install models. The cloud verification environment still cannot obtain native Qwen/voice files from Hugging Face; a ZIP does not remove that limitation.

## Data, offline use and licenses

Data defaults to `studio/.data`, Qwen files to `.runtime`, and Python to `.venv`; optional overrides can choose other paths, and speech/browser models can use their own caches. Copy `.env.example` to `.env` only for optional settings. Keep actual private data, vaults and credentials separate from source sharing; none is included in this kit.

After dependencies, runtimes and required models are successfully installed, supported local features can work offline while app/model processes run. Research, cooperation, payments and publishing need connectivity. No hosted inference fallback is provided.

Preserve `licenses`, `worker/lavasr/LICENSE`, `worker/lavasr/UPSTREAM.md` and `../dependencies/etro`. Etro 0.14.1 is GPL-3.0 and its corresponding source/license accompany the browser bundle. Speech/model installers obtain separate artifacts under their own licenses; see `licenses/VOICE.md` and `PROVENANCE.md`. Packaging checks do not establish native-device or arbitrary-task readiness.
