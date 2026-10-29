# Anascummis

The original Anascummis cyan orb on its white ground, with voice as the working interface. Website editing, user-supplied images, PDF tools and BabylonJS scenes run behind the conversational harness. The new studio is in `apps/studio`; the previous Worker assistant remains available as legacy source. `bun run dev` now selects the studio.

## Current verification status

The Bun backend has 23 passing tests and passes TypeScript checking. Tests exercise immutable PDF revisions, real PyMuPDF text edits and PNG rendering, website escaping, vault encryption, local request guards, ZIP exports, specialist tool permissions, handoff isolation, shared agent budgets, duplicate prevention, verification and cancellation.

The Next.js production build and full frontend TypeScript check pass. Browser checks verify the original orb renderer and the absence of dashboard/editor/composer controls. A browser CPU round-trip synthesizes “Show my website.” with Supertonic and recognizes it with Whisper tiny English. The matching ORT factory and explicitly decompressed WASM binary ship with the app. Actual Qwen3-0.6B Q4_0 inference on four CPU threads successfully delegated a website title change, generated grounded arguments and verified the saved value in 2.66 seconds across three calls. This excludes recognition and speech; broader Qwen workflows, browser inference accuracy, native Piper and desktop installation still need verification.

The public demo is deployed at https://anascummis.com (2026-10-07), Worker `anascummis-demo`, version `28aad209-3db1-4b13-a1ae-cb82d3a23826`. Anonymous requests return HTTP 200 without an Access redirect. A hostname-scoped Everyone bypass makes the demo public; the original admin allow policy and all three unrelated Access applications are preserved. The static demo has no legacy D1 binding or private local files. Deployment backups are kept locally in `.deploy-backups/` and excluded from Git. Specialist harnesses and verification limits are documented in [SMALL-MODEL.md](apps/studio/SMALL-MODEL.md).

## Install and run locally

Use **Download** in the running app to obtain its versioned local source ZIP and SHA-256. The supported build prepares that copy's same-origin kit and manifest, including source provenance, payload hashes, lockfile, setup guide and existing licenses. Extract it and follow `studio/LOCAL-INSTALL.md`. This is a source kit to install, not a prebuilt desktop executable; private data, installed dependencies, caches and model weights are excluded.

Install Bun, Node 20.9 or newer and Python. The bounded Linux packaging workflow uses Bun 1.3.14, Node 24.19.0 and Python 3.12.14; other platforms/native runtimes remain separately unverified. Allow several GB of free space. A modern 64-bit computer with 8 GB RAM is a practical target, not a measured minimum.

From `apps/studio`, or `studio` inside the extracted ZIP:

```sh
bun install --frozen-lockfile
bun run setup
bun run build
bun run start
```

Open `http://127.0.0.1:3211`. This opens the UI before model/voice setup and honestly reports unavailable services. The build also creates its versioned download under `out/opensource`; `bun run kit:build` packages source only. `bun run demo:build` copies that output for the existing demo without deploying. Missing/invalid manifests show a retry instead of silently downloading an unknown external version.

To enable native AI/voice, follow `LOCAL-INSTALL.md`: run `bun run model:setup` and `bun run speech:setup` when their providers are accessible, then keep `bun run model:start` and `bun run start` in separate terminals. Windows x64 model setup obtains an official CPU llama.cpp runtime. macOS/Linux/other architectures need a compatible runtime and `LLAMA_SERVER`. Model/speech files are not bundled; failed downloads do not establish readiness. Cloud checks still observe Hugging Face 403 and cannot establish native Qwen/voice readiness.

For frontend development use `bun run dev`; the backend proxies Next on 3212. Once required dependencies/runtimes/models are successfully installed, supported local features can work offline. Research, cooperation, payments and deployment need connectivity. No hosted model fallback is used.

## Voice interaction

Touch the holographic orb to start listening. After sustained speech, 650 ms of silence ends the turn; touching it again also finishes recording. Touch during thought or speech, or press Escape, to stop. Choose **Type a message** to open the message field; pressing Space twice within 450 ms remains a keyboard shortcut. Enter adds a new line; use Send or Ctrl/Command+Enter to submit. There is no navigation bar or dashboard. Requested previews appear as result surfaces.

Drop supported images, PDFs, recordings or videos onto the orb. File cards show transfer progress, processing, receipt or failure; successful transfers receive a spoken acknowledgement. The public demo accepts PNG/JPEG images; native PDF/audio/video tools require the local app. The shared metadata includes Open Graph and Twitter large-image cards with a 1200×630 orb-only thumbnail rendered from the same shader.

Speech and model runtimes initialize independently. The local Qwen service needs the setup commands above and a running model server; browser runtime initialization may also download files. **AI model** reports local service reachability, and **Voice** reports initialization for this page. These checks do not establish task accuracy, microphone access or a complete spoken conversation. **Check again** repeats the readiness checks; **Setup instructions** opens the existing installation dialog.

## Website workspace

- Edit name, headline, copy, typography, colors and named sections through conversation with the orb.
- Upload PNG/JPEG images. Site tools only accept image identifiers supplied by the host; they cannot substitute stock or generated images.
- Preview HTML in a sandboxed iframe. Content is escaped, and text/link colors adapt to the background for readability.
- Keep immutable revisions. The backend retains revision fences and version restoration.
- Add bounded BabylonJS primitives in conversation and inspect the scene in the 3D tab. Local site exports include the bundled scene renderer when built.
- Export a website ZIP with HTML, images, editable `site.json`, `scene.json`, and Workers static-assets configuration. `public/` is ready for the included Wrangler configuration.
- Use an existing hosted Stripe Payment Link. The studio rejects private Stripe credentials in website content. It does not implement orders, subscriptions, fulfillment or a webhook backend; a success page is not payment evidence.

The current website harness edits a typed section/primitive schema. It is not yet an arbitrary Next.js source generator, a design-import engine, a complete ecommerce builder or an unrestricted code executor. Generated websites currently use static HTML/CSS; the studio itself uses Next.js and React.

## PDF tools and private details

Open PDFs in the same workspace. Conversation tools read exact page text, replace text, add positioned text, redact a region, rotate pages, insert uploaded images/signatures, and add red grading comments, highlights or strikeouts. The host checks tool arguments, and the PDF engine refuses clipped text rather than saving a broken edit. The backend also supports cropping, page operations, form filling, metadata and reflow through its edit API.

Ask the orb to show the website, show the scene, open a PDF, attach an image, close the preview, or export the PDF as PNG. File selection uses the system picker after touching the orb again; editing stays conversational. Current voice PNG export uses page 1. Backend APIs retain image-to-PDF and revision operations.

The passphrase vault uses scrypt and AES-256-GCM and locks after 15 minutes of inactivity. Its entries are only supplied to a local model turn when explicitly selected. Turns with private saved details cannot enable research. PDFs, images, website revisions, chat logs and model traces are stored separately without vault encryption; inserting a saved detail into a document makes it part of that document and its history. Upload a signature as an image; cryptographic PDF signing is not implemented.

## Model harness

One quantized Qwen3 0.6B model performs routing and argument generation across specialist harnesses. The coordinator delegates small tasks with scoped tools and explicit evidence handoffs. Each turn shares at most 48 model calls, 18 host actions and six delegations. The host validates arguments, verifies writes, retains evidence outside the 2,048-token prompt, stops repeated mutations and cancels unfinished work. Nothing the model writes becomes shell code. See `apps/studio/SMALL-MODEL.md` for execution contracts and measured limitations.

This follows the useful small-decision idea behind NanoJev without assuming a game-trained checkpoint understands websites. There is no claim of perfect understanding. The current tests use a scripted inference adapter to test host behavior; actual Qwen task accuracy and CPU performance still need evaluation.

Local specialist tasks now keep a durable work history with their full goals, progress, specialist summaries and outcomes. Say **show work** to open its floating window and inspect the associated website or PDF. Local tasks continue when the page closes, and history returns after reloading. After a backend restart, unfinished specialist work is marked interrupted for review; software builds retain their separate resumable checkpoints. This does not automatically replay edits that may already have been saved.

Unsuccessful or interrupted Work cards offer **Edit saved request**. It prepares the exact saved text for review in the message field, with its website and PDF context, before you explicitly send a new attempt. Review any saved changes first; this does not resume the old task or submit it automatically. Existing unsent text or unavailable context blocks preparation with a message on that card. **Setup instructions** opens the same installation dialog when runtime setup needs attention.

For goals with several steps, say **show goals** to open the local Goals window, or begin a message with **plan this goal:** followed by the full request. A planner creates dependent milestones, specialist executors work within their existing capabilities, and a separate reviewer checks each milestone against its acceptance condition. The window shows recorded progress, host evidence and review decisions together. It also provides an optional open-PDF attachment and explicit public-research opt-in. Closing the page leaves local work running; Stop keeps the plan, and Continue remaining work preserves accepted milestones while retrying unfinished work with your guidance. Reopened windows restore saved goals and show work that needs attention after an interruption.

Each software milestone links to its saved child build. **Open software build** selects that build in the Software work window, where its actual checks, screenshots and verified downloads can be inspected. Active child builds are linked while work continues, and older builds load directly even when they have moved out of recent history.

Completed software builds offer **Revision guidance** and **Create revised build**. Guidance creates a separate child build from the accepted revision, reconciles its acceptance criteria and queues fresh checks. The Software work window selects the child and shows its requested revision and parent link. The accepted parent and its verified downloads remain available while the child is checked. New downloads appear after the child's own checks and artifact verification pass.

Paused or stopped builds offer optional **Guidance for continuing** before **Resume checkpoint**. New guidance is saved separately from the original revision request and remains visible after reloading. Leave it empty to continue with the saved instructions. Each build shows its own pending action and any resume error.

Software cards show current status, activity and parent links before the saved request. Open **Full saved goal** to read the complete request. Floating windows fit the viewport when it narrows and retain their tab state and user layout choices as space changes.

Goals, Work and Software windows also have saved activity timelines with dates, roles, milestone references and revisions. Open a history disclosure, use **Show earlier activity** to read older pages, and choose **Refresh activity** when you want a fresh snapshot. Reading position and loaded pages stay in place while the live status updates. Failed requests keep the loaded history available for retry. Imported history is identified, with an explicit notice when older events may already be missing.

Optional research tools read public HTTPS pages with DNS pinning/private-address checks. Brave web/news search requires `BRAVE_SEARCH_KEY`. Web content is treated as untrusted evidence and carries source URLs and retrieval timestamps. Without network tools, current events should not be represented as verified.

## Recording and video skills

Say **open a recording**, touch the orb to choose your audio, then describe the edit. Audio-only recordings are transcribed locally with timed Whisper segments. The video specialist can combine the recording with video clips, uploaded PNG/JPEGs and actual public-page screenshots, add captions/fades, change speed/framing, and export a checked MP4 through local FFmpeg. **Preview the timeline** opens an Etro layer preview; **export video** downloads the rendered MP4. The orb remains the main interface.

FFmpeg/FFprobe are required. Online YouTube imports need yt-dlp; isolated background browser capture needs Node and Chrome/Edge. Web search needs the configured Brave key. Source tools are granted only for explicit online requests. Six trusted video recipes are retrieved one at a time rather than stuffed into the model prompt. See [video setup, tools, limits and verification](apps/studio/VIDEO.md). Desktop-app control and autonomous creative accuracy are not established by the current checks.

## Speech

Replies are spoken automatically. The local app prefers a local Piper executable and installed voice; browser replies use Supertonic WASM. No Chrome `speechSynthesis` or remote speech inference is used. `speech:setup` installs Piper into the Python environment and downloads an English Lessac medium voice/config/model card. Piper and voice redistribution licenses must be included in a future installer. Microphone audio is decoded and resampled to 16 kHz, then transcribed with Whisper tiny English in a local Web Worker. Recording ends on the second orb touch or after 30 seconds. Microphone tracks close before the reply is generated.

## Cloudflare and the public demo

The local backend exposes Wrangler login, account status and explicit website publishing. Wrangler owns OAuth credentials; neither the model nor the generated site receives those credentials. Publishing deploys a static-assets Worker for the selected site. Automatic expiration/deletion of temporary sites is not implemented yet.

`apps/studio/wrangler.demo.jsonc` prepares a public static studio demo on `workers.dev` and `anascummis.com`, using the same exported Next frontend. The public demo has no personal files or hosted language-model inference. Its Worker supports bounded news/image retrieval and Durable Object collaboration. Website editing uses browser state and user-uploaded images. Qwen runs in a Web Worker on the visitor's CPU through Transformers.js/WASM; the first request downloads model files. Speech generation and recognition were exercised in the test browser; broader device compatibility, memory use and Qwen task accuracy still need evaluation. PDF tools, the encrypted vault, publishing, native PDF/video tools and Pocket TTS with LavaSR require the local application. Demo uploads are kept in browser memory; exported HTML embeds them.

```sh
bun run demo:build
bun run demo:deploy
```

The orb frontend is deployed to `https://anascummis.com` as `anascummis-demo`. Its hostname has a public Access bypass; administrative services remain separate. Native PDF/video tools, private storage and background browser capture require the local app and are not exposed by the public static Worker.

## Checks and reference material

```sh
cd apps/studio
bun run test
bun run typecheck
```

PDF tests need the installed Python PDF environment or `PYTHON_PATH`. `tsconfig.core.json` checks the backend independently of frontend dependencies. The test wrapper cleans temporary SQLite data after the child process exits, which avoids Windows file locks.

Kinoinstrument was read online. See `apps/studio/PROVENANCE.md` for the reviewed files/commit, Stripe skill and reused PDF source. Previous architecture and deployment instructions are in `LEGACY_ARCHITECTURE.md`; they describe the legacy Worker, not the new local runtime. Existing legacy build/test scripts remain available; `legacy:dev` selects the previous Vite frontend.






## Streaming voice and shared goals

Run `bun run speech:setup` after setup to install CPU Pocket TTS, the Alba voice and LavaSR enhancement. Native speech streams enhanced 48 kHz audio; browser speech uses Kokoro 82M q8. Model downloads happen once before offline use. See `apps/studio/licenses/VOICE.md` for attribution and `apps/studio/REALTIME.md` for measured latency and limitations. This does not establish support for every consumer computer.

Say or type work together to open the floating collaboration panel. Invites and opt-in public goal discovery are supported. Signed encrypted messages carry plans, task proposals and results; each participant accepts work locally. See `apps/studio/PEERS.md`. Networking is required for cooperation and current research.

## Persistent software builder

Software requests now use a durable local queue with the full goal, milestones, source workspace and acceptance evidence saved in SQLite. Work continues in background slices and resumes after restart. The orb's Software work panel shows real build checks, screenshots and verified ZIP/Windows executable downloads. Say “show builds” to open it.

The online orb can pair with this local builder using the private key shown in the local Software work panel. The key is held in the browser session and does not go to the model or Cloudflare. Initial dependencies/model installation requires connectivity; cached local inference and editing work offline. See `apps/studio/SOFTWARE.md` for execution scope, progress-sensitive stall limits and measured end-to-end evidence. A completed simple recipe does not establish that Qwen can autonomously create OnlineSlop.

News retrieval uses Google News RSS. If Google returns HTTP 503, one public BBC News RSS feed supplies recent matching headlines with original links, dates and BBC attribution. Redirects are rejected for both providers; topics without recent matching evidence return an error. See `apps/studio/licenses/NEWS.md` for the RSS notice.
