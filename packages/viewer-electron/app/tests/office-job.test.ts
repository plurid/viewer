import { expect, it } from 'vitest';
import { createOfficeJob } from '../src/desktop/previews/office-job';

it('preserves a basename without interpreting URL punctuation, Unicode or script text', () => {
  for (const name of [
    'Quarterly report.DOCX',
    '見積 #1 (50%).docx',
    '%2e%2e%2fprivate.docx',
    '<script>alert("field")</script>.docx'.replaceAll('/', '_'),
  ]) {
    const job = createOfficeJob('docx', { name });
    expect(job.inputPath).toBe('/tmp/viewer-input/' + name);
    const url = new URL(job.inputURL);
    expect(url.protocol).toBe('file:');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(decodeURIComponent(url.pathname)).toBe(job.inputPath);
  }
});

it('rejects host paths, traversal, malformed names and format mismatches before rendering', () => {
  for (const name of [
    '/private/report.docx',
    '../report.docx',
    'C:\\private\\report.docx',
    'report\0.docx',
    '',
    '.',
    '..',
    'report.xlsx',
    'a'.repeat(1025) + '.docx',
    '\ud800.docx',
  ])
    expect(() => createOfficeJob('docx', { name })).toThrow('filename');
  expect(() => createOfficeJob('html', { name: 'report.html' })).toThrow('format');
});

it('keeps worksheet selection separate from the RAM filename and bounds it', () => {
  expect(createOfficeJob('xls', { name: 'Budget.xls', sheet: 'Cost / revenue' })).toEqual({
    extension: 'xls',
    inputPath: '/tmp/viewer-input/Budget.xls',
    inputURL: 'file:///tmp/viewer-input/Budget.xls',
    sheet: 'Cost / revenue',
  });
  for (const sheet of ['', 'A'.repeat(201), 'Sheet\0'])
    expect(() => createOfficeJob('xlsx', { sheet })).toThrow('worksheet');
  expect(createOfficeJob('ppt').inputPath).toBe('/tmp/viewer-input/input.ppt');
});
