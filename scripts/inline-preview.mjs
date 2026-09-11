import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Fold the preview build into one file.
 *
 * `dist/preview` is an ordinary site — an HTML file pointing at a script, a
 * stylesheet and four font files. That is the right shape for serving, and the
 * wrong shape for handing to somebody who has nowhere to serve it from. This
 * inlines all of it so the preview is a single document that opens from a file
 * or from anywhere that will host one.
 *
 * The fonts are inlined rather than fetched. A preview that falls back to the
 * system sans because a font URL 404'd still looks like a page, and the person
 * looking at it has no way to tell that the typography they are judging is not
 * the typography that ships. Wrong quietly is worse than wrong loudly.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist/preview`;

const html = await readFile(`${out}/preview.html`, 'utf8');
let css = await readFile(`${out}/preview.css`, 'utf8');
const js = await readFile(`${out}/preview.js`, 'utf8');

const mime = { woff2: 'font/woff2', woff: 'font/woff' };

const inlined = new Map();
async function dataUri(href) {
  if (inlined.has(href)) return inlined.get(href);
  const name = href.replace(/^\//, '');
  const bytes = await readFile(`${out}/${name}`);
  const ext = name.split('.').pop();
  const uri = `data:${mime[ext] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
  inlined.set(href, uri);
  return uri;
}

/*
 * Drop the `woff` sources and keep `woff2`.
 *
 * Fontsource emits both formats in one `src` list for browsers old enough to
 * need the fallback. Every browser that will ever load this preview reads
 * woff2, so the woff copies are ~70 kB of base64 carried for nobody. The whole
 * src descriptor goes rather than the string, or the remaining format() hint
 * would describe the wrong file.
 */
css = css.replace(
  /src:\s*url\([^)]*\.woff2\)\s*format\("woff2"\),\s*url\([^)]*\.woff\)\s*format\("woff"\)/g,
  (match) => match.replace(/,\s*url\([^)]*\.woff\)\s*format\("woff"\)/, ''),
);

for (const [, href] of css.matchAll(/url\((\/[^)]+)\)/g)) {
  const uri = `url(${await dataUri(href)})`;
  css = css.replaceAll(`url(${href})`, () => uri);
}

const script = html.match(/<script[^>]*src="\/preview\.js"[^>]*><\/script>/);
if (!script) throw new Error('No preview.js script tag in the built HTML — did the entry name change?');

/*
 * Every replacement below is a *function*, and that is load-bearing.
 *
 * `String.replace` expands `$&`, `` $` `` and `$'` inside a string replacement,
 * and the bundle contains `$&` — as source, in its own `.replace(mt,"$&/")`. As a
 * string replacement that expands to the entire matched script tag, so the tag
 * was pasted into the middle of the JavaScript, corrupting the bundle while the
 * page still looked like it had built. A function replacement is used verbatim
 * and cannot be re-read as a pattern.
 */
const single = html
  .replace(script[0], () => `<script type="module">\n${js}\n</script>`)
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);

const target = `${root}dist/preview.html`;
await writeFile(target, single, 'utf8');

/*
 * The publishing shape.
 *
 * A hosted page is a fragment: the host wraps it in its own doctype, head and
 * body, so handing it a complete document nests one inside the other. The outer
 * scaffolding comes off and the title moves to the top, where the host looks
 * for it — and the metas go, because the host sets charset and viewport itself
 * and a second viewport tag in the body is one too many.
 *
 * This is the same bytes as `preview.html` minus the wrapper, so there is
 * exactly one build and no chance of the two drifting.
 */
const fragment = single
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<meta[^>]*>\s*/gi, '')
  .trimStart();

const fragmentTarget = `${root}dist/preview.artifact.html`;
await writeFile(fragmentTarget, fragment, 'utf8');

const { size } = await stat(target);
const { size: fragmentSize } = await stat(fragmentTarget);
console.log(
  `dist/preview.html           ${(size / 1024).toFixed(0)} kB  (${inlined.size} font files inlined)\n` +
    `dist/preview.artifact.html  ${(fragmentSize / 1024).toFixed(0)} kB  (fragment, for publishing)`,
);
