# Native research-document implementation findings

The four official sources in primary-source-index.json were fetched through the existing readPublicSource guard, with normal HTTPS transport, address checks, zero redirects and the existing byte/time bounds. Receipt files preserve source URL/title/retrieval time/raw-byte SHA256/normalized-text SHA256 and bounded exact excerpts. No transport fallback or guard bypass was used.

## Rendering

PyMuPDF Story constructor parses HTML into a DOM; pass only host-constructed HTML with all answer/notes/citation/title/source fields escaped. Do not pass user or source HTML as executable markup. The Story docs say archive supplies image/font resources; omitting archive avoids supplying an arbitrary resource directory. Use only fixed host CSS and standard fonts, with no images, script, arbitrary styles or external-resource tags.

The documented Story.write rectfn callback returns (mediabox, content rectangle, transform), while Story.write_with_links returns a PDF document and adds internal HTML links. Bound pages/iterations explicitly. Page.insert_htmlbox is a single rectangle helper and may scale content; for readable multi-page content prefer explicit pagination rather than assuming a single successful call guarantees complete usable output.

Installed PyMuPDF version is 1.28.2. A bounded local synthetic proof (pagination-prototype.py/json and original PDFs) laid out 25 repeated paragraphs plus a 300-character URL, model SHA256 and final marker. All variants paginated to two pages. Plain text, CSS overflow-wrap:anywhere + word-break:break-all, and <wbr> lost part of the long URL in extracted text and produced a span outside the content margin. Inserting deterministic whitespace between 12-character URL/hash chunks preserved the complete identity ignoring whitespace and stayed in bounds. This is renderer proof only, not a product/native-answer result. Add explicit deterministic break opportunities to unbroken identities in PDF display, retain exact machine-readable URL/hash in metadata and HTML href, and test extracted text after whitespace normalization. Do not silently truncate. A successful PDF save, page count, end marker or screenshot is insufficient by itself.

For actual completion proof, open the final PDF with PyMuPDF, extract every page, compare all expected answer paragraphs/notes/citation quotes/question/title/source identities to the expected text under a stated normalization, check the final marker and page bounds, then render/view first and last and any dense source-identity page. Verify actual HTML bytes/type and parse visible text as well. A PDF filename or success toast does not prove completeness.

## Persistence

SQLite documents that commands are transactional, explicit BEGIN...COMMIT does not nest, and a failed COMMIT with SQLITE_BUSY leaves the transaction active for later explicit retry. Keep artifact identity and the goal/result reference in one existing synchronous database transaction after output validation. Filesystem writes are not made atomic by that transaction: stage/write a new immutable artifact first, validate/hash it, then atomically record the unique identity/reference; on interruption a retry should reuse only a matching committed artifact, or safely discard/replace uncommitted staging without repeating accepted reading/inference. Never mark completion before the final file exists and verifies. A unique key on goal/accepted-result/artifact format or content identity prevents duplicate committed outputs after lost delivery.

The WAL docs distinguish crash recovery from power-loss durability: synchronous=FULL syncs WAL at transaction commits; NORMAL may lose durability after power loss/hard reboot. Observe actual configured PRAGMAs before claiming durability. The requested process SIGTERM/SIGKILL/reopen checks do not establish host power-failure guarantees or filesystem fsync coverage.

## Scope

No app source changed. No new dependencies, model downloads or services. The initial research helper failed because bun was not in this shell PATH; rerunning the same script with the existing installed /workspace/.cloud-tools/node_modules/.bin/bun succeeded. The separate model receipt records the read-only root HF cache permission boundary without bypassing it. Model identity/readiness is not answer quality.
