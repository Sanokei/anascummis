import {test, expect} from 'bun:test';
import {exportRequest, resolveExport} from '../core/workspace-export';

test('website export target/format survives an attached PDF and selected PDF preview', () => {
  for (const format of ['html', 'zip'] as const) {
    const intent = exportRequest('export website as ' + format)!;
    expect(resolveExport(intent.format!, intent.target, {pdf: true, video: false, preview: 'pdf'})).toEqual({target: 'website', format});
  }
  expect(resolveExport('', exportRequest('export my site')!.target, {pdf: true, video: false})).toEqual({target: 'website', format: 'zip'});
});

test('missing or mismatched targets refuse export rather than return a different document', () => {
  expect(() => resolveExport('png', 'pdf', {pdf: false, video: false})).toThrow('Open a PDF');
  expect(() => resolveExport('pdf', 'website', {pdf: true, video: false})).toThrow('does not match');
  expect(() => resolveExport('html', 'pdf', {pdf: true, video: false})).toThrow('does not match');
  expect(() => resolveExport('mp4', 'video', {pdf: true, video: false})).toThrow('finished video');
});

test('implicit export uses requested format then active preview; prose is not consumed as an export', () => {
  expect(resolveExport('html', undefined, {pdf: true, video: false})).toEqual({target: 'website', format: 'html'});
  expect(resolveExport('', undefined, {pdf: true, video: false, preview: 'website'})).toEqual({target: 'website', format: 'zip'});
  expect(resolveExport('', undefined, {pdf: true, video: false})).toEqual({target: 'pdf', format: 'pdf'});
  expect(exportRequest('download my website as html')).toEqual({target: 'website', format: 'html'});
  expect(exportRequest('please build an export tool')).toBeUndefined();
});
