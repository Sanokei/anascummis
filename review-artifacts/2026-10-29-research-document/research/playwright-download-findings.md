# Browser download verification: official Playwright guidance

Both sources were retrieved normally through the existing readPublicSource guard. Exact URL/title/retrieval timestamps/raw and normalized content SHA256, bounded excerpts and receipt hashes are in playwright-download-source-index.json. These are upstream main-branch documents identified by retrieved content hash, not a claim of a pinned upstream release. No app source or services changed.

## What the sources state

The official Downloads introduction states: “For every attachment downloaded by the page, Page.download event is emitted.” Its JavaScript example starts page.waitForEvent('download') before clicking, awaits that Download object, then calls download.saveAs(...).

The Download API states: “Download event is emitted once the download starts. Download path becomes available once download completes.” Thus observing Download alone establishes a started download, not completed or correct payload bytes.

The API states Download.saveAs copies the download to a user-specified path, is safe while the download is in progress and waits for completion if necessary. Download.failure waits for completion if necessary and returns a download error if any. Download.path returns a successful downloaded file path, throws on failed/cancelled downloads, and throws when connected remotely. Temporary files are deleted when their browser context closes, so save the actual download before closing that context.

## What these sources do not guarantee

Neither of these two documents promises that page.waitForResponse will receive a matching Page.response event for an attachment browser download, or specifies its ordering relative to Download. They do not document the observed helper timeout as a Playwright bug or universal browser behavior. Record the observed timeout separately from the successful Download evidence; do not infer a failed app export merely from that helper timeout, and do not infer a framework bug from this observation alone.

## Sound scoped acceptance

Register page.waitForEvent('download') before activating the ordinary export link. Await the Download, persist it using saveAs while the context is alive, check failure() is null, then inspect actual saved bytes/signature/full content/hash/openability. Download URL and suggested filename are metadata, not content proof.

A separate authenticated GET of the exact same export href can independently check HTTP status/content-type and full byte equality against the browser-downloaded file and stored artifact identity. This is a distinct read, not the response object or original headers/status of the browser's download transaction; label it that way. Exact byte equality makes the two fetched payloads equivalent for that verification but does not establish broad cross-browser, native-OS or physical-handset behavior.

## Metadata annotation

The Downloads source uses YAML front matter title "Downloads". The existing plain-text title normalizer mistakenly selected a Python example comment as a Markdown heading. The saved research receipt preserves that original normalizerTitle and annotates the exact publisher front-matter title; no product code was changed.
