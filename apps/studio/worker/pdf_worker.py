"""One bounded PDF operation per process. Paths are supplied only by the Bun harness."""
import json, sys, os, math, re
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import pymupdf as fitz
from PIL import Image


def color(value=None, default=(0.12, 0.14, 0.19)):
    if value is None:
        return default
    if not isinstance(value, str) or len(value) != 7 or not value.startswith('#'):
        raise ValueError('Color must be #RRGGBB')
    return tuple(int(value[i:i+2], 16) / 255 for i in (1, 3, 5))


def page_at(doc, number):
    if not isinstance(number, int) or number < 1 or number > len(doc):
        raise ValueError(f'Page must be between 1 and {len(doc)}')
    return doc[number - 1]


def rect_on(page, values):
    r = fitz.Rect(values)
    bounds = fitz.Rect(0, 0, page.cropbox.width, page.cropbox.height)
    if r.is_empty or r.is_infinite or not all(math.isfinite(v) for v in r) or not bounds.contains(r):
        raise ValueError('Rectangle must fit inside the page; coordinates are PDF points, top-left origin')
    return r


def font_for(page, style='sans', text=''):
    fonts = {'sans': ('arial.ttf', 'helv'), 'serif': ('times.ttf', 'tiro'),
             'mono': ('consola.ttf', 'cour')}
    filename, fallback = fonts.get(style, fonts['sans'])
    if all(ord(c) < 128 for c in text):
        return fallback
    path = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / filename
    if path.exists():
        alias = 'Lover' + style
        page.insert_font(fontname=alias, fontfile=str(path))
        return alias
    return fallback


def textbox(page, r, text, size=12, ink=None, style='sans', align=0):
    font = font_for(page, style, text)
    result = page.insert_textbox(r, text, fontsize=size, fontname=font,
                                color=ink or color(), align=align)
    if result < 0:
        raise ValueError('Text does not fit. Increase the box or reduce fontSize. Nothing was saved.')


def normalized(text):
    return text.replace('\xa0', ' ').replace('\xad', '-')


def inspect(doc, pages=None):
    nums = pages or list(range(1, min(len(doc), 8) + 1))
    result = []
    for num in nums:
        p = page_at(doc, num)
        spans = []
        for block in p.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for s in line['spans']:
                    spans.append({'text': normalized(s['text']), 'rect': list(s['bbox']),
                                  'size': round(s['size'], 2), 'font': s['font']})
        result.append({'page': num, 'width': p.cropbox.width, 'height': p.cropbox.height,
                       'rotation': p.rotation, 'text': normalized(p.get_text())[:18000],
                       'spans': spans[:300], 'forms': [
                           {'name': w.field_name, 'value': w.field_value, 'type': w.field_type_string,
                            'rect': list(w.rect)} for w in p.widgets() or []]})
    return {'pageCount': len(doc), 'metadata': doc.metadata, 'pages': result,
            'scanned': bool(result) and all(not p['text'].strip() for p in result)}


class BriefMarkup(HTMLParser):
    """The research renderer accepts only the host's inert document vocabulary."""
    tags = {'html', 'head', 'meta', 'title', 'style', 'body', 'main', 'h1', 'h2', 'p', 'br', 'a'}
    attributes = {'lang', 'charset', 'name', 'content', 'http-equiv'}

    def __init__(self):
        super().__init__()
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            if len(attrs) != 1 or attrs[0][0] != 'href' or not safe_brief_link(attrs[0][1]):
                raise ValueError('Research brief links must be exact public HTTPS source links')
            return
        if tag not in self.tags or any(key not in self.attributes for key, value in attrs):
            raise ValueError('Research brief markup must be inert host-generated text')
        if tag == 'style':
            self.in_style = True

    def handle_endtag(self, tag):
        if tag not in self.tags:
            raise ValueError('Unsupported research brief markup')
        if tag == 'style':
            self.in_style = False

    def handle_data(self, data):
        if self.in_style and re.search(r'url\s*\(|@import', data, re.I):
            raise ValueError('Research brief styles cannot fetch resources')


def safe_brief_link(value):
    if not isinstance(value, str) or len(value) > 2000:
        return False
    url = urlsplit(value)
    return url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password and url.port in (None, 443)


def verify_brief(doc, expected, expected_links):
    if not isinstance(expected, list) or not expected or len(expected) > 100 or any(
            not isinstance(value, str) or len(value) > 12000 for value in expected):
        raise ValueError('Research brief text expectations are invalid')
    if not 1 <= len(doc) <= 20:
        raise ValueError('Research brief must contain 1 to 20 pages')
    if not isinstance(expected_links, list) or not 1 <= len(expected_links) <= 2 or any(
            not safe_brief_link(value) for value in expected_links) or len(set(expected_links)) != len(expected_links):
        raise ValueError('Research brief source link expectations are invalid')
    # Expand PDF font ligatures (for example the glyph ﬁ back to fi).
    text = ''.join(page.get_text(flags=fitz.TEXTFLAGS_TEXT & ~fitz.TEXT_PRESERVE_LIGATURES, sort=True) for page in doc)
    ligatures = str.maketrans({'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st'})
    compact = lambda value: ''.join(value.translate(ligatures).split())
    actual, position = compact(text), 0
    # Expectations are ordered, so repeated notes/quotations must really occur
    # again rather than matching a different earlier section.
    for index, value in enumerate(expected):
        wanted = compact(value)
        found = actual.find(wanted, position)
        if found < 0:
            raise ValueError('Research brief rendering omitted or changed expected text at section ' + str(index + 1))
        position = found + len(wanted)
    links = []
    for page in doc:
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    x0, y0, x1, y1 = span['bbox']
                    if not all(math.isfinite(v) for v in span['bbox']) or x0 < 47 or y0 < 47 or x1 > 548 or y1 > 795:
                        raise ValueError('Research brief text exceeds the printable page bounds')
        for link in page.get_links():
            uri, rect = link.get('uri'), link.get('from')
            if uri not in expected_links or rect is None or not fitz.Rect(47, 47, 548, 795).contains(rect):
                raise ValueError('Research brief has an unexpected or out-of-bounds link')
            links.append(uri)
    # Story may emit several adjacent URI annotations for one anchor's words.
    # Every annotation above is checked; compare the ordered distinct exact URIs.
    unique_links = list(dict.fromkeys(links))
    if unique_links != expected_links:
        raise ValueError('Research brief did not preserve each exact source URL as a usable PDF link')
    return {'pageCount': len(doc), 'complete': True, 'contained': True, 'links': unique_links, 'linksContained': True, 'linkAnnotations': len(links)}


def run(job):
    op, a = job['op'], job.get('args', {})
    output = job.get('output')
    if op == 'research_brief':
        html = a.get('html')
        if not isinstance(html, str) or len(html) > 100000:
            raise ValueError('Research brief markup is invalid or contains a resource reference')
        parser = BriefMarkup()
        parser.feed(html)
        story = fitz.Story(html, user_css='body {font-family:sans-serif;font-size:11pt;}')
        def page_rect(number, filled):
            if number > 20:
                raise ValueError('Research brief exceeds 20 pages')
            return fitz.Rect(0, 0, 595, 842), fitz.Rect(48, 48, 547, 794), None
        doc = story.write_with_links(page_rect)
        doc.set_metadata({'title': a.get('title', 'Research brief'), 'producer': 'Anascummis fixed research-brief renderer'})
        result = verify_brief(doc, a.get('expected'), a.get('expectedLinks'))
        doc.save(output, garbage=4, deflate=True)
        return result
    if op == 'verify_research_brief':
        with fitz.open(job['input']) as doc:
            return verify_brief(doc, a.get('expected'), a.get('expectedLinks'))
    if op == 'image_info':
        with Image.open(job['image']) as im:
            if im.format not in ('PNG', 'JPEG') or im.width * im.height > 40_000_000:
                raise ValueError('Choose a PNG/JPEG under 40 megapixels')
            im.verify()
            return {'width': im.width, 'height': im.height, 'format': im.format}
    if op == 'images_to_pdf':
        doc = fitz.open()
        for path in job['images']:
            with Image.open(path) as im:
                im.load()
                width, height = im.size
            if width * height > 40_000_000:
                raise ValueError('Image exceeds 40 megapixels')
            p = doc.new_page(width=595, height=842)
            p.insert_image(fitz.Rect(24, 24, 571, 818), filename=path, keep_proportion=True)
        doc.save(output, garbage=4, deflate=True)
        return {'pageCount': len(doc)}
    if op == 'create':
        doc = fitz.open()
        p = doc.new_page(width=595, height=842)
        textbox(p, fitz.Rect(48, 40, 547, 115), a.get('title', 'Untitled document'), 26, style='serif')
        textbox(p, fitz.Rect(48, 125, 547, 780), a.get('text', ''), 12)
        doc.save(output, garbage=4, deflate=True)
        return {'pageCount': 1}
    doc = fitz.open(job['input'])
    if doc.needs_pass:
        raise ValueError('Password-protected PDF: decrypt a copy before importing')
    if not len(doc) or len(doc) > 500:
        raise ValueError('PDF must contain 1 to 500 pages')
    if op == 'inspect':
        return inspect(doc, a.get('pages'))
    if op == 'render':
        p = page_at(doc, a.get('page', 1))
        dpi = a.get('dpi', 120)
        if dpi < 36 or dpi > 300:
            raise ValueError('DPI must be 36 to 300')
        if p.rect.width * p.rect.height * (dpi / 72) ** 2 > 30_000_000:
            raise ValueError('Rendered page exceeds 30 megapixels; lower DPI')
        p.get_pixmap(dpi=dpi, alpha=False).save(output)
        return {'file': output}
    if op == 'export_png':
        files = []
        for n in a.get('pages') or range(1, len(doc) + 1):
            p = page_at(doc, n)
            dpi = a.get('dpi', 144)
            if p.rect.width * p.rect.height * (dpi / 72) ** 2 > 30_000_000:
                raise ValueError('Page too large for selected DPI')
            path = str(Path(output) / f'page-{n:03d}.png')
            p.get_pixmap(dpi=dpi, alpha=False).save(path)
            files.append(path)
        return {'files': files}
    result = {'operation': op}
    if op == 'add_text':
        p = page_at(doc, a['page'])
        textbox(p, rect_on(p, a['rect']), a['text'], a.get('fontSize', 12),
                color(a.get('color')), a.get('font', 'sans'), a.get('align', 0))
    elif op == 'replace_text':
        p = page_at(doc, a['page'])
        hits = p.search_for(a['find'])
        if not hits:
            raise ValueError('Exact text not found on that page. Read the page to get its actual text.')
        if not a.get('all', False):
            index = a.get('occurrence', 1) - 1
            if index < 0 or index >= len(hits):
                raise ValueError('Occurrence not found')
            hits = [hits[index]]
        spans = [s for b in p.get_text('dict')['blocks'] for l in b.get('lines', []) for s in l['spans']]
        replacements = []
        for r in hits:
            matching = [s for s in spans if fitz.Rect(s['bbox']).intersects(r)]
            size = a.get('fontSize') or (matching[0]['size'] if matching else 12)
            # A replacement must fit its original area unless the user explicitly supplies a new box.
            box = rect_on(p, a['rect']) if a.get('rect') else fitz.Rect(r.x0, max(0, r.y0 - 2), r.x1, min(p.cropbox.height, r.y1 + size))
            replacements.append((box, size))
            p.add_redact_annot(r, fill=color(a.get('background'), (1, 1, 1)))
        p.apply_redactions(images=0, graphics=0)
        for box, size in replacements:
            textbox(p, box, a['replace'], size, color(a.get('color')), a.get('font', 'sans'))
        result['matches'] = len(hits)
    elif op == 'redact':
        p = page_at(doc, a['page'])
        p.add_redact_annot(rect_on(p, a['rect']), fill=color(a.get('color'), (0, 0, 0)))
        p.apply_redactions(images=2, graphics=2)
        doc.set_metadata({})
        if doc.is_pdf:
            doc.del_xml_metadata()
        result['note'] = 'Removed content in this region, including intersecting graphics. Review all pages for duplicate sensitive information.'
    elif op == 'annotate':
        p = page_at(doc, a['page'])
        r = rect_on(p, a['rect'])
        kind = a.get('kind', 'comment')
        if kind == 'highlight':
            ann = p.add_highlight_annot(r)
        elif kind == 'strikeout':
            ann = p.add_strikeout_annot(r)
        else:
            scratch = fitz.open()
            check = scratch.new_page(width=p.cropbox.width, height=p.cropbox.height)
            textbox(check, r, a['comment'], a.get('fontSize', 10))
            scratch.close()
            ann = p.add_freetext_annot(r, a['comment'], fontsize=a.get('fontSize', 10),
                                      text_color=color(a.get('color'), (0.8, 0.1, 0.15)),
                                      fill_color=(1, .96, .94))
        ann.set_info(content=a['comment'], title=a.get('author', 'PDF File Lover'))
        ann.update()
    elif op == 'insert_image':
        p = page_at(doc, a['page'])
        p.insert_image(rect_on(p, a['rect']), filename=job['image'], keep_proportion=True)
    elif op == 'rotate_pages':
        for n in a['pages']:
            p = page_at(doc, n)
            p.set_rotation((p.rotation + a['degrees']) % 360)
    elif op == 'crop_page':
        p = page_at(doc, a['page'])
        p.set_cropbox(rect_on(p, a['rect']))
    elif op == 'select_pages':
        for n in a['pages']:
            page_at(doc, n)
        doc.select([n - 1 for n in a['pages']])
    elif op == 'delete_pages':
        nums = sorted(set(a['pages']), reverse=True)
        if len(nums) >= len(doc):
            raise ValueError('Cannot delete every page')
        for n in nums:
            page_at(doc, n)
            doc.delete_page(n - 1)
    elif op == 'insert_page':
        pos = a.get('afterPage', len(doc))
        if pos < 0 or pos > len(doc):
            raise ValueError('Invalid insertion position')
        p = doc.new_page(pno=pos, width=a.get('width', 595), height=a.get('height', 842))
        textbox(p, fitz.Rect(40, 40, p.rect.width - 40, p.rect.height - 40), a.get('text', ''), a.get('fontSize', 12))
    elif op == 'fill_form':
        count = 0
        for p in doc:
            for w in p.widgets() or []:
                if w.field_name in a['values']:
                    w.field_value = a['values'][w.field_name]
                    w.update()
                    count += 1
        if not count:
            raise ValueError('No matching PDF form fields. Use add_text for flat forms.')
        result['fieldsFilled'] = count
    elif op == 'merge_pdf':
        other = fitz.open(job['other'])
        if len(doc) + len(other) > 500:
            raise ValueError('Merged document exceeds 500 pages')
        doc.insert_pdf(other)
    elif op == 'reflow':
        # A newly typeset document; the caller supplies the edited content, not HTML or executable code.
        new = fitz.open()
        paragraphs = a['text'].split('\n')
        size, margin = a.get('fontSize', 12), 48
        p = new.new_page(width=595, height=842)
        textbox(p, fitz.Rect(margin, 40, 547, 105), a.get('title', 'Document'), 24, style='serif')
        y = 116
        font = fitz.Font('helv')
        for para in paragraphs:
            words, lines, line = para.split(), [], ''
            for word in words:
                candidate = (line + ' ' + word).strip()
                if font.text_length(candidate, fontsize=size) > 499 and line:
                    lines.append(line)
                    line = word
                else:
                    line = candidate
            lines.append(line)
            for line in lines:
                if y + size * 2 > 794:
                    p = new.new_page(width=595, height=842)
                    y = 48
                textbox(p, fitz.Rect(margin, y, 547, y + size * 2.2), line, size, style=a.get('font', 'sans'))
                y += size * 1.5
            y += size * .5
        doc = new
    elif op == 'metadata':
        doc.set_metadata({**doc.metadata, **a['values']})
    elif op == 'ocr':
        p = page_at(doc, a['page'])
        tp = p.get_textpage_ocr(language=a.get('language', 'eng'), dpi=150, full=True)
        return {'page': a['page'], 'text': p.get_text(textpage=tp), 'note': 'OCR text for reading; original page unchanged.'}
    else:
        raise ValueError('Unknown PDF operation')
    doc.save(output, garbage=4, deflate=True, clean=True)
    result['pageCount'] = len(doc)
    return result


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'result': run(json.load(sys.stdin))}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
