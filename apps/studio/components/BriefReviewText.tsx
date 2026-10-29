import {Fragment, type ReactNode} from 'react';
import type {BriefDraft} from '../core/research-brief-types';

export type BriefReviewCitation = {number: number; quote: string};
type InlinePart = string | {code: string} | {label: string; href: string};

/** A browser-only presentation of already saved evidence. No HTML is executed,
 * no destination is fetched here, and model text cannot introduce a new link. */
function publicHttps(value: string) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    if (!host.includes('.') || host === 'localhost' || /\.(?:localhost|local|internal)$/u.test(host) || host.includes(':')) return false;
    // URL normalizes unusual IPv4 spellings before this check. Literal IP
    // destinations are intentionally inert in this review surface.
    if (/^\d+(?:\.\d+){3}$/u.test(host)) return false;
    return true;
  } catch {return false;}
}

function urls(text: string) {
  return (text.match(/https:\/\/[^\s<>"'`\[\]()]+/gu) || [])
    .map(value => value.replace(/[.,;!?]+$/u, ''))
    .filter(publicHttps);
}

function inlineParts(text: string, allowed: Set<string>, links = true): InlinePart[] {
  const parts: InlinePart[] = [];
  const literal = (value: string) => {
    const previous = parts.at(-1);
    if (typeof previous === 'string') parts[parts.length - 1] = previous + value;
    else parts.push(value);
  };
  for (let index = 0; index < text.length;) {
    if (text[index] === '<') {
      const end = text.indexOf('>', index + 1);
      if (end >= 0) {literal(text.slice(index, end + 1)); index = end + 1; continue;}
    }
    if (text[index] === '`' && text[index - 1] !== '\\') {
      const end = text.indexOf('`', index + 1);
      if (text[index + 1] !== '`' && end > index + 1 && text[end + 1] !== '`' && !/[\r\n]/u.test(text.slice(index + 1, end))) {
        parts.push({code: text.slice(index + 1, end)}); index = end + 1; continue;
      }
      literal(text.slice(index)); break;
    }
    if ((text[index] === '[' || text.startsWith('![', index)) && text[index - 1] !== '\\') {
      const image = text[index] === '!', match = /^(?:!)?\[([^\]\r\n]+)\]\(([^\s()<>]+)\)/u.exec(text.slice(index));
      if (match) {
        if (links && !image && publicHttps(match[2]) && allowed.has(match[2])) parts.push({label: match[1], href: match[2]});
        else literal(match[0]);
        index += match[0].length; continue;
      }
      if (text.indexOf('](', index + 1) >= 0) {literal(text.slice(index)); break;}
    }
    if (links && text.startsWith('https://', index) && !/[\p{L}\p{N}_]/u.test(text[index - 1] || '')) {
      const match = /^https:\/\/[^\s<>"'`\[\]()]+/u.exec(text.slice(index));
      if (match) {
        const href = match[0].replace(/[.,;!?]+$/u, '');
        if (publicHttps(href) && allowed.has(href)) {parts.push({label: href, href}); index += href.length; continue;}
      }
    }
    literal(text[index]); index++;
  }
  return parts;
}

function rendered(text: string, allowed: Set<string>, links = true): ReactNode {
  return inlineParts(text, allowed, links).map((part, index) => typeof part === 'string' ? <Fragment key={index}>{part}</Fragment>
    : 'code' in part ? <code key={index}>{part.code}</code>
    : <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{rendered(part.label, allowed, false)}</a>);
}

/** Display formatting only. Exact model/raw text remains owned by the caller. */
export function BriefReviewText({draft, citations = []}: {draft: BriefDraft; citations?: readonly BriefReviewCitation[]}) {
  const destinations = new Map(citations.map(citation => [citation.number, urls(citation.quote)]));
  const allowed = new Set([...destinations.values()].flat());
  return <>{draft.paragraphs.map((paragraph, index) => <p key={index} className="brief-review-paragraph">
    {rendered(paragraph.text, allowed)}{' '}
    <span className="brief-review-citations">{paragraph.citations.map((number, citationIndex) => {
      const href = destinations.get(number)?.[0];
      return <Fragment key={citationIndex}>{citationIndex > 0 ? ' ' : ''}{href
        ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={'Citation ' + number + ' source'}>[{number}]</a>
        : <span>[{number}]</span>}</Fragment>;
    })}</span>
  </p>)}</>;
}
