# Current local source kit — 2026-10-29

Download now uses the running build's own versioned source kit, with an exact version, source provenance and archive checksum. The normal build prepares that kit; demo preparation copies the same output. A missing/invalid manifest or unavailable archive disables Download and offers a check again. The modal opens at its kit status, keeps Close visible and scrolls instructions inside its own body.

Repository: `Sanokei/anascummis`. Branch: `codex/source-kit-20261029`.

| Reference | Value |
| --- | --- |
| Preserved base checkpoint | `7fabdbb2d1ff8b70a1717af77be881e0e7c3d2bf` |
| Tested application source | `f8329ebabfa55e99633831501b9952867a47acb3` |
| Source tree | `c787c4ee990ef2ac7e1388e01ce96929f459d13f` |
| Kit version | `c5735e970e817eed43877b610e7bb79af6dde2ad05c452eaf2a320e74f09acd4` |
| Archive size | 1,251,163 bytes; 199 payload files plus its internal manifest |
| Unchanged main | `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917` |

The artifact commit follows the tested source with identical application files. Use the commit recorded in the accompanying chat for pinned retrieval. [source.json](source.json) lists changed paths and scope. [manifest.json](manifest.json) inventories this review pack; [kit-manifest.json](kit-manifest.json) is the actual Download metadata, and [source-payload.json](source-payload.json) is the ZIP's internal source inventory.

## Get and run this copy

Download [anascummis-studio-c5735e970e817eed.zip](anascummis-studio-c5735e970e817eed.zip) and its [SHA-256 file](anascummis-studio-c5735e970e817eed.zip.sha256). The ZIP SHA-256 is:

```text
b73cc2f7f7950efb6ade3d2a7ec5f296a9950f30af0afe760efbe5fa80439f47
```

This is source to install, not a desktop executable. Install Bun, Node 20.9+ and Python, extract the ZIP, then open a terminal inside `studio`:

```sh
bun install --frozen-lockfile
bun run setup
bun run build
bun run start
```

Open `http://127.0.0.1:3211` on that computer. The app can open before model/voice setup and reports missing services. [LOCAL-INSTALL.md](LOCAL-INSTALL.md), also inside the ZIP, gives the exact model/voice steps, separate terminal commands, Windows-x64 automatic runtime versus manual macOS/Linux llama.cpp path, optional tools, verification and limitations. Native model/speech files and installed dependencies are not bundled.

The checked toolchain is Linux x64, Bun 1.3.14, Node 24.19.0 and Python 3.12.14. **Extraction checks explicitly reuse the matching already installed node_modules and Python environment.** They do not establish a fresh online install, Windows/macOS compatibility, physical-handset keyboard behavior, native Qwen quality, microphone capture or spoken replies.

## Before/after and source comparison

| Item | Base behavior | Current tested handoff |
| --- | --- | --- |
| Download target | Hardcoded, unversioned public URL | Same-origin versioned filename from validated metadata |
| Ordinary build | UI output; no local kit | UI plus `out/opensource` kit, checksum, manifest, source catalog and Etro license |
| Demo preparation | Separate publisher after copying UI | Copies the same ordinary build/kit; no deployment |
| Identity | No source/content/archive manifest | Content version, clean source commit, per-file hashes and archive SHA-256 |
| Dependencies | Repository already pins Next 16.4.3/sharp 0.35.5 | Same lockfile/pins retained; Etro 0.14.1 source/license included |
| Standalone types | Existing publisher adapts the alias | Exact shared-types copy and alias adaptation retained and clean-build tested |
| Instructions | Bun/Python; model setup precedes build | Actual Node requirement stated; UI build/start separated from optional model/voice setup |
| Incomplete output | Could advertise an absent ZIP | HEAD checks availability/type and supplied length; no link on failure |

The old public ZIP's [normal HEAD request](receipts/public-download-access.json) returned proxy HTTP403. Its actual bytes/version remain unverified; this pack does **not** claim the live archive is conclusively stale or the public site has been updated. The missing local manifest was independently reproduced in the [before receipt](receipts/before.json). The source-backed [plan](PLAN.md), [research memo](research/findings.md) and [references](research/sources.json) precede/explain the implementation.

| View | Desktop, 1440×1000 | Narrow, 360×800 |
| --- | --- | --- |
| Before: unversioned external download | [PNG](screenshots/before-desktop.png) | [PNG](screenshots/before-narrow.png) |
| Current version, action and checksum | [PNG](screenshots/download-desktop.png) | [PNG](screenshots/download-narrow.png) |
| Saved Work request after opening/closing Download | [PNG](screenshots/recovered-after-download-desktop.png) | [PNG](screenshots/recovered-after-download-narrow.png) |

Also inspect [first use](screenshots/first-use-narrow.png), the [initial action at 360×420 without scrolling](screenshots/download-entry-short.png), [scrolled short-screen instructions](screenshots/instructions-short.png), [missing manifest](screenshots/missing-kit-narrow.png), [invalid manifest](screenshots/invalid-kit-narrow.png) and [missing archive](screenshots/missing-archive-narrow.png). Close stays visible. These are original screenshots of the normal server and exact extracted app, with no provider/voice response mocks. Error cases modify only owned extraction output files and restore them.

The intermediate cf9b7e6 source exposed two additional real defects: [retained scroll clipped its warning](screenshots/prototype-scrolled-warning.png), and [a missing ZIP still had an enabled link](screenshots/prototype-broken-archive.png) despite [HEAD 503](receipts/missing-archive-before.json). Both are corrected in f8329eb; those prototype images are not final passes.

## Actual acceptance and limits

- [Archive audit](receipts/archive-audit.json): CRC and every payload size/hash pass; current page/style/Download/Work/Goal source hashes match the checked repository. `bun.lock`, Next 16.4.3/sharp 0.35.5, required configs/docs, standalone shared types, existing licenses, LavaSR source/license and Etro 0.14.1 corresponding source are present. The documented `tsconfig.json` alias transformation is intentional.
- [Packaging properties](receipts/package-checks.json): a clean extraction repacks byte-identically; dummy private `.env`, SQLite, model, key, cache and pyc inputs remain excluded; a source symlink and missing required lockfile are rejected. These probes use temporary fixtures, not real secrets or parent artifacts.
- [Final ordinary-server lifecycle](receipts/handoff.json): **one explicit download of the current version** is saved and SHA-256 verified. That exact archive clean-extracts, builds, passes TypeScript and starts through `bun run start` on isolated test port 3213. The extracted build reproduces the same version and ZIP bytes. The actual default app instructions remain port 3211.
- Desktop,360×800 and360×420 show the initial download action without manually scrolling to it. Checksum and instructions are reachable in the owned scroll body; Close works with keyboard and touch. Unsent text survives Download. Missing/invalid manifests and a missing ZIP disable the link, and checking again recovers the same version. No archive is pre-downloaded by those checks.
- Real native-unavailable Work retains exact multiline text and a conflicting newer draft. Opening/closing Download while editing it submits nothing. An explicit edited attempt has a distinct saved ID and the original website; the unrelated website stays revision0. [Read-only saved-row verification](receipts/work-record-proof.json) confirms the original record is exactly unchanged, with exactly two explicit Work rows. No task is replayed automatically.
- The [extracted PDF check](receipts/pdf-context.json) uses real imported PDFs and the reused Python environment. Original website/PDF restore together; old record/activity and PDF bytes/revisions stay unchanged. One controlled original-PDF metadata404 checks that missing context never partially switches the current target.
- [Demo copy verification](receipts/demo-copy.json) confirms the prepared demo contains the exact same kit, checksum, manifest, catalog and license. No deployment occurred.

See [3 focused tests/22 assertions](receipts/manifest-tests.txt), [studio TypeScript](receipts/studio-typecheck.txt), [supported production build](receipts/production-build.txt), [extracted build](receipts/extracted-build.txt), [extracted TypeScript](receipts/extracted-typecheck.txt), [handoff completion](receipts/handoff-result.txt) and [PDF completion](receipts/pdf-result.txt). The earlier 192-test/restart/parent-child lifecycle baseline is preserved, not repeated for this packaging/UI increment. No scripted inference is used here; the real model service remains unavailable, so tasks needing it fail honestly.

The [normal server](receipts/normal-server.json) remains running with `model.ready=false`. The [last native egress check](receipts/last-native-egress.json) recorded Hugging Face proxy 403; native setup was not retried and no access/TLS workaround was used. The [saved draft](receipts/environment-draft.json) is still revision 5 with identical install/start instructions. [Parent checks](receipts/preservation.json) confirm accepted metadata/source/test/package/lock/ZIP and earlier review manifest remain unchanged. Main and all earlier checkpoint branches are preserved; no new chat, provider, secret, main promotion or public deployment was created.

## Review helpers and recorded corrections

The [helpers](qa) retain environment-specific paths, isolated port ownership and explicit dependency reuse. They are review evidence, not a portable installer. The user-facing install path is the ZIP's own guide.

The first prototype's real browser download completed and its saved hash passed, but its helper incorrectly counted page-request events, producing [0 versus1](receipts/download-counter-failure.txt). The corrected helper counts download events. Prototype validation resumed from its already verified file rather than redownloading it; the final, changed source version was downloaded once and passed the complete lifecycle. The PDF fixture initially looked for a deliberately excluded extracted `.venv`, producing [null versus0](receipts/pdf-fixture-path-failure.txt); it was corrected to use the existing `PYTHON_PATH`, as the acceptance plan required. Those failed helper attempts are not final passes.

HEAD may omit Content-Length under RFC 9110. The actual Bun response does so; availability/type are checked, length is compared when supplied, and full SHA verification occurs on the explicit download. This keeps checks bounded without speculative ZIP/model downloads. Hashes identify content; they are not signatures or proof of native-device readiness.
