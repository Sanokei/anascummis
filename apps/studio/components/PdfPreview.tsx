'use client';
import {useEffect, useRef, useState} from 'react';

type PdfDocument = {id: string; name: string; pages: number; revision: number};
type ReadingPosition = {documentId: string; page: number; zoom: number; ready: boolean};
const clampedZoom = (value: number) => Math.min(3, Math.max(1, value));

export function PdfPreview({document: pdfDocument}: {document: PdfDocument}) {
  const pageCount = Number.isInteger(pdfDocument.pages) && pdfDocument.pages > 0 ? pdfDocument.pages : 1;
  const clampPage = (value: number) => Math.min(pageCount, Math.max(1, value));
  const [position, setPosition] = useState<ReadingPosition>({documentId: pdfDocument.id, page: 1, zoom: 1, ready: false});
  const [attempt, setAttempt] = useState(0), [storageNotice, setStorageNotice] = useState('');
  const [imageResult, setImageResult] = useState<{url: string; state: 'loaded' | 'error'}>();
  const scroll = useRef<HTMLDivElement>(null), currentUrl = useRef('');
  const storageKey = 'anascummis.pdf-reading.v1.' + pdfDocument.id;

  useEffect(() => {
    let page = 1, zoom = 1;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as {page?: unknown; zoom?: unknown};
        if (typeof saved.page === 'number' && Number.isInteger(saved.page)) page = Math.min(pageCount, Math.max(1, saved.page));
        if (typeof saved.zoom === 'number' && Number.isFinite(saved.zoom)) zoom = clampedZoom(saved.zoom);
      }
    } catch {setStorageNotice('Reading still works. This browser could not restore the saved page and zoom.');}
    setPosition({documentId: pdfDocument.id, page, zoom, ready: true});
    // Root remounts on document identity; saved preferences are also scoped here.
  }, [pdfDocument.id, storageKey]);

  useEffect(() => {
    setPosition(previous => previous.documentId === pdfDocument.id ? {...previous, page: Math.min(pageCount, Math.max(1, previous.page))} : previous);
  }, [pdfDocument.id, pageCount, pdfDocument.revision]);

  useEffect(() => {
    if (!position.ready || position.documentId !== pdfDocument.id) return;
    try {localStorage.setItem(storageKey, JSON.stringify({page: position.page, zoom: position.zoom}));}
    catch {setStorageNotice('Reading still works. Page and zoom will not be saved in this browser.');}
  }, [pdfDocument.id, storageKey, position]);

  const ready = position.ready && position.documentId === pdfDocument.id;
  const page = ready ? clampPage(position.page) : 1, zoom = ready ? position.zoom : 1;
  const url = '/api/documents/' + encodeURIComponent(pdfDocument.id) + '/render?page=' + page + '&revision=' + pdfDocument.revision + (attempt ? '&retry=' + attempt : '');
  currentUrl.current = url;
  const error = ready && imageResult?.url === url && imageResult.state === 'error';
  const loading = !ready || imageResult?.url !== url;

  useEffect(() => {scroll.current?.scrollTo({top: 0, left: 0});}, [pdfDocument.id, page, pdfDocument.revision]);

  function move(change: number) {setPosition(previous => ({...previous, page: clampPage(previous.page + change)}));}
  function magnify(change: number) {setPosition(previous => ({...previous, zoom: clampedZoom(Math.round((previous.zoom + change) * 100) / 100)}));}
  function fit() {setPosition(previous => ({...previous, zoom: 1})); scroll.current?.scrollTo({left: 0});}

  return <section className="pdf-preview" aria-label={'PDF preview: ' + pdfDocument.name}>
    <div className="pdf-preview-toolbar" aria-label="PDF reading controls">
      <div className="pdf-page-navigation">
        <button type="button" aria-label="Previous PDF page" disabled={!ready || page <= 1} onClick={() => move(-1)}>Previous</button>
        <span aria-live="polite" aria-atomic="true">Page {page} of {pageCount}</span>
        <button type="button" aria-label="Next PDF page" disabled={!ready || page >= pageCount} onClick={() => move(1)}>Next</button>
      </div>
      <div className="pdf-zoom-controls">
        <button type="button" aria-label="Zoom out PDF" disabled={!ready || zoom <= 1} onClick={() => magnify(-.25)}>−</button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in PDF" disabled={!ready || zoom >= 3} onClick={() => magnify(.25)}>+</button>
        <button type="button" aria-label="Fit PDF width" disabled={!ready || zoom === 1} onClick={fit}>Fit width</button>
      </div>
      {error && <div className="pdf-preview-error" role="status">
        <p>Could not load PDF page {page}. The document and reading position are kept.</p>
        <button type="button" onClick={() => setAttempt(previous => previous + 1)}>Retry PDF page</button>
      </div>}
      {storageNotice && <small>{storageNotice}</small>}
    </div>
    <div ref={scroll} className="pdf-page-scroll" aria-label="PDF page view" aria-busy={loading} tabIndex={0}>
      {loading && <p className="pdf-preview-loading" role="status">Loading PDF page {page}…</p>}
      {ready && !error && <img key={url} className="pdf-page-image" src={url} alt={'PDF page ' + page}
        style={{width: (zoom * 100) + '%'}}
        onLoad={() => {if (currentUrl.current === url) setImageResult({url, state: 'loaded'});}}
        onError={() => {if (currentUrl.current === url) setImageResult({url, state: 'error'});}}/>}
    </div>
  </section>;
}
