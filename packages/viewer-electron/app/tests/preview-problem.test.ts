// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { previewProblem } from '../src/renderer/previews/preview-problem';

afterEach(() => vi.unstubAllGlobals());

it.each([
  'Allow access to this folder using the folder picker, then try again.',
  'Close some previews before opening more files.',
  'Nested archives are not supported yet.',
  'This file is not gzip-compressed.',
  'This book illustration has unsupported or oversized dimensions.',
  'This DOCX has no readable document body.',
  'This message is no longer in the mailbox.',
  'The database changed while Viewer read it. Try again.',
  'This DjVu file is larger than 256 MB.',
  'This shortcut keeps its address in a resource fork, which Viewer does not read.',
  'Only VRML 2.0 files are supported.',
  'This OFF file is malformed at line 12.',
  'This camera file could not be decoded. It may be damaged or use an unsupported RAW encoding. Open it in its original app.',
  'Image decoding exceeded 10 seconds. Retry or open the file in its original app.',
  'This build of Viewer can’t decode OpenEXR images.',
  'Add this provider’s API key in Settings.',
  'The torrent nests too deeply.',
  'Use a table filter shorter than 4096 characters.',
  'The local preview cache is full. Close a rendered preview and try again.',
])('keeps the reader’s explanation: %s', (message) => {
  expect(previewProblem(new Error(message), 'Preview unavailable.')).toBe(message);
});

it.each([
  [
    new Error("EACCES: permission denied, open '/private/file'"),
    'Viewer needs permission to read this file.',
  ],
  [
    Object.assign(new Error('Access refused /private/file'), { name: 'NotAllowedError' }),
    'Viewer needs permission to read this file.',
  ],
  [
    new Error("ENOENT: no such file or directory, open '/private/file'"),
    'The file has moved or is no longer available.',
  ],
  [
    Object.assign(new Error('file /private/file'), { name: 'MissingPDFException' }),
    'The file has moved or is no longer available.',
  ],
  [
    Object.assign(new Error('Invalid PDF structure at /private/file'), {
      name: 'InvalidPDFException',
    }),
    'The PDF is damaged or incomplete.',
  ],
  [
    Object.assign(new Error('input /private/file'), { code: 'EFBIG' }),
    'The file is too large for this preview.',
  ],
  [new Error('Unsupported file format'), 'Viewer does not support this file format.'],
  [new Error('Unexpected end of file'), 'The file ends before all of its data can be read.'],
  [
    new Error('Malformed or encrypted ZIP local header.'),
    'This archive entry is damaged or encrypted.',
  ],
  [new Error('Invalid worksheet cell address.'), 'The worksheet is damaged or incomplete.'],
  [new Error('File is corrupted'), 'The file is damaged or incomplete.'],
  [new SyntaxError('Unexpected token "too large" while parsing JSON'), 'Preview unavailable.'],
  [new TypeError('Cannot read properties of undefined'), 'Preview unavailable.'],
  [new Error('This message is no longer in the mailbox.\n/private/file'), 'Preview unavailable.'],
])('shows the known cause and logs the original failure for %s', (error, message) => {
  const diagnosticReport = vi.fn(async () => {});
  vi.stubGlobal('viewer', { diagnosticReport });
  expect(previewProblem(error, 'Preview unavailable.')).toBe(message);
  expect(diagnosticReport).toHaveBeenCalledWith(
    expect.objectContaining({ detail: expect.stringContaining(error.message) }),
  );
});
