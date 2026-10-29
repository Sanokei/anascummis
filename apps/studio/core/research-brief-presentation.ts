import type {BriefDraft} from './research-brief-types';
import {publicSourceUrl, type SourceSnapshot} from './public-source';

/** A new document presentation, never an in-place rewrite of a retained v1 file.
 * The separate provenance files preserve every exact quote, URL and machine field.
 * This renderer cannot fetch resources or run source/model-provided markup. */
export type BriefDocumentInput = {
  title: string; question: string; guidance?: string; notes: string;
  paragraphs: BriefDraft['paragraphs'];
  citations: {number: number; quote: string; sourceId: string; label: string; offset: number}[];
  sources: SourceSnapshot[]; scope?: string; provenance: Record<string, unknown>;
};
export type BriefDocument = {
  version: 'brief-document-v2'; html: string; pdfHtml: string;
  expected: string[]; expectedLinks: string[]; provenanceHtml: string; provenanceJson: string;
};
type Part = {kind: 'text' | 'code'; text: string} | {kind: 'link'; text: string; href: string};
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));

/** Formatting, not a Markdown interpreter. Only literal inline code and public
 * HTTPS links are recognized. Labels and targets are retained without rewriting.
 * Everything else is escaped text, including HTML, images and source instructions. */
function parts(value: string): Part[] {
  const result: Part[] = [];
  const add = (part: Part) => {
    const previous = result.at(-1);
    if (part.kind === 'text' && previous?.kind === 'text') previous.text += part.text;
    else result.push(part);
  };
  for (let i = 0; i < value.length;) {
    if (value[i] === '`' && value[i - 1] !== '\\' && value[i + 1] !== '`') {
      const end = value.indexOf('`', i + 1);
      if (end > i + 1 && value[end + 1] !== '`' && !/[\r\n]/u.test(value.slice(i + 1, end))) {
        add({kind: 'code', text: value.slice(i + 1, end)}); i = end + 1; continue;
      }
    }
    if (value[i] === '[' && value[i - 1] !== '!' && value[i - 1] !== '\\') {
      const match = /^\[([^\]\r\n]+)\]\((https:\/\/[^\s()<>]+)\)/u.exec(value.slice(i));
      if (match) {
        try {
          publicSourceUrl(match[2]);
          // A link label may contain inline code, but cannot introduce another link.
          const label = parts(match[1]).map(part => part.text).join('');
          add({kind: 'link', text: label, href: match[2]}); i += match[0].length; continue;
        } catch { /* Unsupported destinations remain inert literal source text. */ }
      }
    }
    if (value.startsWith('https://', i)) {
      const match = /^https:\/\/[^\s<>"`]+/u.exec(value.slice(i));
      if (match) {
        const target = match[0].replace(/[),.;!?]+$/u, '');
        try {publicSourceUrl(target); add({kind: 'link', text: target, href: target}); i += target.length; continue;} catch { /* Inert text. */ }
      }
    }
    add({kind: 'text', text: value[i]}); i++;
  }
  return result;
}

/** MuPDF Story ignores some browser word-breaking rules. Only exceptionally long
 * visible tokens need explicit layout whitespace; prefer URL/path delimiters,
 * then a generous 56-character bound. The raw strings remain exact in provenance.
 * No ordinary URL, hash or note is fragmented at arbitrary 12-character offsets. */
function pdfWrap(value: string) {
  return value.replace(/\S{65,}/gu, token => {
    const chars = Array.from(token); let line = 0, out = '';
    for (let index = 0; index < chars.length; index++) {
      out += chars[index]; line++;
      if (index < chars.length - 1 && ((line >= 28 && /[/#?&=._-]/u.test(chars[index])) || line >= 56)) {out += ' '; line = 0;}
    }
    return out;
  });
}

function page(title: string, content: string, provenance = false) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>' + escape(title) + '</title><style>'
    + 'body{font-family:sans-serif;font-size:11pt;line-height:1.45;color:#18313a;background:white;margin:0}main{max-width:760px;margin:auto;padding:32px 24px}h1{font-size:25pt;line-height:1.18;color:#123b48;margin:0 0 18px}h2{font-size:13pt;color:#245668;margin:24px 0 8px}p{margin:7px 0;overflow-wrap:anywhere;word-break:break-word}a{color:#145a75;text-decoration:underline}code{font-family:monospace;font-size:.94em}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:monospace;font-size:10pt;line-height:1.5} @media(max-width:420px){main{padding:22px 16px}h1{font-size:22pt}} @media print{main{padding:0}body{font-size:11pt}}'
    + '</style></head><body><main>' + (provenance ? '<h1>' + escape(title) + '</h1>' : '') + content + '</main></body></html>';
}

export function buildBriefDocument(input: BriefDocumentInput): BriefDocument {
  if (!input.title.trim() || input.title.length > 120 || input.notes.length > 12000 || !input.paragraphs.length || !input.citations.length || input.citations.length > 2) throw new Error('The revised brief needs a title, complete bounded notes, factual paragraphs and one or two citations.');
  const used = new Set<number>();
  for (const citation of input.citations) {
    if (!Number.isInteger(citation.number) || citation.number < 1 || used.has(citation.number) || !citation.quote || !input.sources.some(source => source.id === citation.sourceId)) throw new Error('The revised brief citation identity is invalid.');
    used.add(citation.number);
  }
  for (const paragraph of input.paragraphs) if (!paragraph.text.trim() || !paragraph.citations.length || paragraph.citations.some(number => !used.has(number))) throw new Error('The revised brief paragraph has no valid saved citation.');
  const expected: string[] = [], links: string[] = [];
  const recordLink = (href: string) => {publicSourceUrl(href); if (!links.includes(href)) links.push(href);};
  const text = (value: string, pdf: boolean) => escape(pdf ? pdfWrap(value) : value).replace(/\n/g, '<br>');
  const inline = (value: string, pdf: boolean, formatted: boolean) => {
    const tokens: Part[] = formatted ? parts(value) : [{kind: 'text', text: value}];
    if (!pdf) expected.push(tokens.map(part => part.text).join(''));
    return tokens.map(part => {
      if (part.kind === 'link') {recordLink(part.href); return '<a href="' + escape(part.href) + '">' + text(part.text, pdf) + '</a>';}
      return part.kind === 'code' ? '<code>' + text(part.text, pdf) + '</code>' : text(part.text, pdf);
    }).join('');
  };
  const render = (pdf: boolean) => {
    const section = (heading: string, value: string, formatted = false) => {
      const body = inline(value, pdf, formatted);
      return pdf ? '<p><b>' + text(heading, pdf) + ':</b> ' + body + '</p>' : '<h2>' + escape(heading) + '</h2><p>' + body + '</p>';
    };
    let result = '<h1>' + inline(input.title, pdf, false) + '</h1>';
    result += section('Brief', input.paragraphs.map(paragraph => paragraph.text + ' ' + paragraph.citations.map(number => '[' + number + ']').join(' ')).join('\n\n'), true);
    result += section('Source question', input.question);
    if (input.guidance) result += section('Question guidance', input.guidance);
    if (input.notes) result += section('Your notes — personal, not source claims', input.notes);
    for (const citation of input.citations) result += section('Reference [' + citation.number + ']', citation.quote, true);
    for (const source of input.sources.filter(source => input.citations.some(citation => citation.sourceId === source.id))) {
      const label = source.title || new URL(source.url).hostname;
      // Human source identity is readable. The exact URL, retrieval record, two
      // distinct hash domains and lineage IDs belong in the explicit detail file.
      if (!pdf) expected.push(label, 'Retrieved: ' + source.retrievedAt);
      recordLink(source.url);
      result += (pdf ? '<p><b>Source:</b> ' : '<h2>Source</h2><p>') + '<a href="' + escape(source.url) + '">' + text(label, pdf) + '</a><br>' + text('Retrieved: ' + source.retrievedAt, pdf) + '</p>';
    }
    result += section('About this document', 'Local-model wording, not independently fact-checked. Full source and editing provenance is available in the work window.');
    return result;
  };
  const html = page(input.title, render(false)), pdfHtml = page(input.title, render(true));
  if (links.length > 16 || html.length > 100000 || pdfHtml.length > 100000) throw new Error('The revised brief exceeds its bounded rendering budget; no content was shortened.');
  const provenance = {
    version: 'brief-document-v2',
    presentationMethod: 'Host formatting only: matched inline code and public HTTPS Markdown links are displayed as code/links. No source claim or personal note is shortened or paraphrased. Exceptionally long PDF tokens use layout whitespace; exact original strings remain below.',
    title: input.title, question: input.question, guidance: input.guidance, personalNotes: input.notes,
    paragraphs: input.paragraphs, citations: input.citations, sources: input.sources,
    scope: input.scope, evidence: input.provenance
  };
  const provenanceJson = JSON.stringify(provenance, null, 2) + '\n';
  const provenanceHtml = page(input.title + ' — provenance details', '<p>This detail view preserves the original strings and machine evidence. Display formatting in the ordinary brief does not replace this record.</p><pre>' + escape(provenanceJson) + '</pre>', true);
  return {version: 'brief-document-v2', html, pdfHtml, expected, expectedLinks: links, provenanceHtml, provenanceJson};
}
