import {test, expect} from 'bun:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {buildBriefDocument, type BriefDocumentInput} from '../core/research-brief-presentation';
import type {SourceSnapshot} from '../core/public-source';

const id = '6944e644-ebd4-4307-a0a2-f0db57249428';
const quote = 'Tests for the Fetch Standard can be found in the `fetch/` directory of [`web-platform-tests/wpt`](https://github.com/web-platform-tests/wpt).';
const quote2 = 'A dashboard showing the tests running against browser engines can be seen at [wpt.fyi/results/fetch](https://wpt.fyi/results/fetch).';
function fixture(): BriefDocumentInput {
  return {
    title: 'Fetch test contributor brief', question: 'Where are the tests and browser results?',
    notes: 'Keep my entire personal note. <img src="https://example.org/private" onerror="alert(1)">\nNever turn this note into a source-backed claim.',
    paragraphs: [{text: 'The Fetch tests live in fetch/ under web-platform-tests/wpt. Browser results are at https://wpt.fyi/results/fetch.', citations: [1, 2]}],
    citations: [{number: 1, quote, sourceId: id, label: 'source-1', offset: 1914}, {number: 2, quote: quote2, sourceId: id, label: 'source-1', offset: 2057}],
    sources: [{id, title: 'README.md', goalId: 'parent-goal-machine-identity', taskId: 'source-1', requestedUrl: 'https://raw.githubusercontent.com/whatwg/fetch/main/README.md', url: 'https://raw.githubusercontent.com/whatwg/fetch/main/README.md', retrievedAt: '2026-10-29T22:06:27.711Z', sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), normalization: 'public-text-v1', type: 'text/plain', textLength: 4815, bytes: 4815} as SourceSnapshot],
    scope: 'Text identity is checked; factual accuracy is not independently verified.',
    provenance: {rawNativeResponse: {paragraphs: [{text: '`Original raw native decision`', citations: [1]}]}, parentGoal: 'parent-goal-machine-identity'}
  };
}

async function worker(job: Record<string, unknown>) {
  const root = resolve(import.meta.dir, '..'), python = process.env.PYTHON_PATH || join(root, '.venv/bin/python');
  const child = Bun.spawn([python, join(root, 'worker/pdf_worker.py')], {stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'});
  child.stdin.write(JSON.stringify(job)); child.stdin.end();
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const value = JSON.parse(stdout); if (exit || !value.ok) throw new Error(value.error || stderr);
  return value.result;
}

test('v2 body formats the real source quotations while keeping every raw string in explicit provenance', () => {
  const input = fixture(), before = structuredClone(input), document = buildBriefDocument(input);
  expect(input).toEqual(before); expect(document.version).toBe('brief-document-v2');
  expect(document.html).toContain('<code>fetch/</code>');
  expect(document.html).toContain('<a href="https://github.com/web-platform-tests/wpt">web-platform-tests/wpt</a>');
  expect(document.html).not.toContain('`fetch/`'); expect(document.html).not.toContain('[wpt.fyi/results/fetch](');
  expect(document.html).not.toContain('Snapshot:'); expect(document.html).not.toContain('SHA-256'); expect(document.html).not.toContain('parent-goal-machine-identity');
  expect(document.html).not.toContain('https://raw.githubusercontent.com/whatwg/fetch/main/README.md</a>');
  expect(document.html).toContain('Retrieved: 2026-10-29T22:06:27.711Z');
  const details = JSON.parse(document.provenanceJson);
  expect(details.citations.map((citation: {quote: string}) => citation.quote)).toEqual([quote, quote2]);
  expect(details.personalNotes).toBe(input.notes); expect(details.sources[0]).toEqual(input.sources[0]); expect(details.evidence).toEqual(input.provenance);
  expect(document.provenanceHtml).toContain('provenance details'); expect(document.provenanceHtml).toContain('&lt;img');
  expect(document.expectedLinks).toEqual(['https://wpt.fyi/results/fetch', 'https://github.com/web-platform-tests/wpt', input.sources[0].url]);
  expect(document.expected.join('\n')).toContain(input.notes); expect(document.html).not.toContain('<img');
});

test('model/source HTML and private links cannot execute or become active destinations', () => {
  const input = fixture();
  input.citations[0].quote += ' <script>alert(1)</script> [private](https://127.0.0.1/private) [run](javascript:alert(1))';
  input.notes = '[keep this literal note](https://example.org/note) `literal note code`';
  const document = buildBriefDocument(input);
  expect(document.html).not.toContain('<script>'); expect(document.html).toContain('&lt;script&gt;');
  expect(document.html).not.toContain('href="https://127.0.0.1'); expect(document.html).not.toContain('href="javascript:');
  expect(document.html).toContain(input.notes); expect(document.expected).toContain(input.notes);
  expect(document.expectedLinks).not.toContain('https://example.org/note');
});

test('real renderer preserves full multi-page notes, formatted claims and exact link annotations without body hashes', async () => {
  const input = fixture(); input.notes += '\n\n' + 'My full user-supplied handoff note remains separate from cited facts, with all actions and uncertainties preserved. '.repeat(26);
  const dir = await mkdtemp(join(tmpdir(), 'brief-presentation-')), output = join(dir, 'revised.pdf');
  try {
    const document = buildBriefDocument(input), result = await worker({op: 'research_brief', output, args: {html: document.pdfHtml, title: input.title, expected: document.expected, expectedLinks: document.expectedLinks}});
    expect(result.pageCount).toBeGreaterThan(1); expect(result.complete).toBe(true); expect(result.contained).toBe(true); expect(result.links).toEqual(document.expectedLinks); expect(result.linksContained).toBe(true);
    const inspected = await worker({op: 'inspect', input: output, args: {pages: Array.from({length: result.pageCount}, (_, index) => index + 1)}});
    const text = inspected.pages.map((page: {text: string}) => page.text).join('\n'), compact = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');
    expect(compact(text)).toContain(compact(input.notes)); expect(text).not.toContain('Snapshot:'); expect(text).not.toContain('SHA-256'); expect(text).not.toContain('`fetch/`'); expect(text).not.toContain('](');
    expect((await readFile(output)).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(worker({op: 'verify_research_brief', input: output, args: {expected: document.expected, expectedLinks: document.expectedLinks.slice(0, 2)}})).rejects.toThrow('unexpected');
  } finally {await rm(dir, {recursive: true, force: true});}
}, 20000);

test('long literal user URLs wrap at useful delimiters while exact note and link target remain in provenance', async () => {
  const input = fixture(), url = 'https://example.org/' + ['a-long-public-path-component', 'another-long-public-component', 'last-path-component'].join('/');
  input.notes = 'My own unverified reference: ' + url + '\nDo not remove this note.';
  const document = buildBriefDocument(input), dir = await mkdtemp(join(tmpdir(), 'brief-long-note-'));
  try {
    const output = join(dir, 'long-note.pdf'), result = await worker({op: 'research_brief', output, args: {html: document.pdfHtml, title: input.title, expected: document.expected, expectedLinks: document.expectedLinks}});
    expect(result.complete).toBe(true); expect(result.contained).toBe(true); expect(JSON.parse(document.provenanceJson).personalNotes).toBe(input.notes);
    expect(document.html).toContain(url); expect(document.pdfHtml).not.toContain('https://exam ple');
  } finally {await rm(dir, {recursive: true, force: true});}
}, 20000);

test('actual native probe wording and complete 1719-character handoff keep the footer with the document', async () => {
  // Replay of the two actual local-native prompt-only probe strings. This is a
  // renderer regression, not a new native decision, UI edit or approval proof.
  const input = fixture();
  input.question = 'Where are the Fetch Standard’s tests kept, and where can I see them running against browser engines? Cite the README statements supporting both.';
  input.notes = "Personal handoff for my next Fetch test contribution. These are my own proposed actions and working notes, not instructions or verified claims from the source.\n\nBefore changing anything, I will record the browser and version, a minimal public example, the outcome I expected and what I actually saw. I will remove cookies, authorization headers, account details and private URLs from anything I share.\n\n1. Reopen this brief and follow its original-source link. Compare the saved retrieval time with the current README. If the evidence changed, ask a new focused question instead of editing the accepted copy.\n2. Open the browser-results location from the brief. Write down the engine and platform I inspected. A saved answer is a pointer to evidence, not proof that a bug exists or a test passes.\n3. Search the cited test directory for a related case before proposing another test. Keep the candidate filename, my reason for choosing it and any unresolved question in my own draft.\n4. Separate reproduction from implementation. First describe a small public fixture and expected behavior; then explain the proposed test and the observation it should distinguish.\n5. Read the project's current contribution and review instructions before submitting anything. I have not checked those instructions yet, and this brief does not establish them.\n6. Keep a handoff log of what I tried, which evidence I saved and what remains uncertain. After interruption, inspect saved work and continue deliberately rather than repeating accepted research.\n7. Preserve the PDF and HTML with their recorded hashes and original citations. Ask for missing guidance instead of guessing. My personal checklist is not a source-backed conclusion.";
  input.paragraphs = [{text: 'Tests: ' + quote + ' Browser results: ' + quote2, citations: [1, 2]}];
  expect(input.notes.length).toBe(1719);
  const document = buildBriefDocument(input), dir = await mkdtemp(join(tmpdir(), 'brief-native-layout-'));
  try {
    const output = join(dir, 'native-probe-layout.pdf'), rendered = await worker({op: 'research_brief', output, args: {html: document.pdfHtml, title: input.title, expected: document.expected, expectedLinks: document.expectedLinks}});
    expect(rendered.pageCount).toBe(1); expect(rendered.complete).toBe(true); expect(rendered.contained).toBe(true); expect(rendered.links).toEqual(document.expectedLinks);
    const inspected = await worker({op: 'inspect', input: output, args: {pages: [1]}}), text = inspected.pages[0].text.normalize('NFKC').replace(/\s+/gu, '');
    expect(text).toContain(input.notes.normalize('NFKC').replace(/\s+/gu, ''));
    expect(text).toContain('andeditingprovenanceisavailableintheworkwindow.');
    expect(JSON.parse(document.provenanceJson).personalNotes).toBe(input.notes);
  } finally {await rm(dir, {recursive: true, force: true});}
}, 20000);
