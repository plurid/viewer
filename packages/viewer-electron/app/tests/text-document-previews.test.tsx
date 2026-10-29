// @vitest-environment jsdom
/**
 * Notebooks, calendars and contacts, and subtitles render as documents from their text, keep a
 * Source view of that text, and fall back to the text view for content they do not read.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { FileEntry, ResourceRead } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import NotebookPreview from '../src/renderer/previews/modules/NotebookPreview';
import CardsPreview from '../src/renderer/previews/modules/CardsPreview';
import SubtitlesPreview from '../src/renderer/previews/modules/SubtitlesPreview';
import { initialize } from '../src/renderer/state/store';
import { mockElementBox } from './support/layout';

beforeAll(() => {
  // the text view reads the editor's font settings
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  // virtualized lists measure their scroller; jsdom lays nothing out
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 800, top: 0, left: 0, right: 800, bottom: 800, x: 0, y: 0 }) as DOMRect;
  mockElementBox(800, 800);
});
afterEach(cleanup);

function context(name: string, text: string, read: Partial<ResourceRead> = {}): PreviewContext {
  const extension = name.split('.').pop()!;
  const entry = {
    path: `/fixtures/${name}`,
    name,
    parent: '/fixtures',
    extension,
    mime: 'text/plain',
    size: text.length,
    kind: 'file',
    directory: false,
    identity: '1:1',
    modified: 1,
    created: 1,
    hidden: false,
  } as FileEntry;
  const reply: ResourceRead = { text, truncated: false, binary: false, ...read };
  return {
    resource: { id: 'resource', entry, url: '' } as unknown as PreviewContext['resource'],
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services: { read: async () => reply } as unknown as PreviewContext['services'],
  };
}

const show = (Preview: ComponentType<PreviewContext>, name: string, text: string) =>
  render(<Preview {...context(name, text)} />);

const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const notebook = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python' },
  },
  cells: [
    { cell_type: 'markdown', source: ['# Sales\n', '<script>window.ran = true</script>Totals'] },
    {
      cell_type: 'code',
      execution_count: 3,
      source: 'import math\nprint(math.pi)',
      outputs: [
        { output_type: 'stream', name: 'stdout', text: '3.141592653589793\n' },
        { output_type: 'display_data', data: { 'image/png': pixel, 'text/plain': 'Figure' } },
        {
          output_type: 'display_data',
          data: { 'text/html': '<img src=x onerror="window.ran = true">' },
        },
      ],
    },
  ],
});

describe('notebook preview', () => {
  it('renders Markdown, highlighted code and safe outputs, never the HTML', async () => {
    const view = show(NotebookPreview, 'sales.ipynb', notebook);
    await waitFor(() => expect(view.getByRole('heading', { name: 'Sales' })).toBeTruthy());
    await waitFor(() =>
      expect(view.container.querySelector('.notebook-source .token.keyword')?.textContent).toBe(
        'import',
      ),
    );
    expect(view.getByText('[3]')).toBeTruthy();
    expect(view.getByText('3.141592653589793')).toBeTruthy();
    expect(view.getByRole('img', { name: 'Figure' }).getAttribute('src')).toBe(
      `data:image/png;base64,${pixel}`,
    );
    expect(view.getByText('HTML output is not rendered.')).toBeTruthy();
    expect(view.container.querySelector('script, [onerror]')).toBeNull();
    expect(view.getByText('Python 3 · 2 cells')).toBeTruthy();
    expect((window as { ran?: boolean }).ran).toBeUndefined();
  });

  it('shows the notebook source in the text view and returns to the notebook', async () => {
    const view = show(NotebookPreview, 'sales.ipynb', notebook);
    fireEvent.click(await view.findByRole('button', { name: 'Source' }));
    await waitFor(() =>
      expect(view.getByLabelText('File text').textContent).toContain('"nbformat":4'),
    );
    expect(view.getByRole('button', { name: 'Source' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Notebook' }));
    await waitFor(() => expect(view.getByRole('heading', { name: 'Sales' })).toBeTruthy());
  });

  it('shows invalid and oversized notebooks as text with a note', async () => {
    const invalid = show(NotebookPreview, 'broken.ipynb', '{"cells": [');
    await waitFor(() =>
      expect(invalid.container.textContent).toContain('This notebook could not be read.'),
    );
    await waitFor(() => expect(invalid.getByLabelText('File text')).toBeTruthy());
    cleanup();
    const large = render(
      <NotebookPreview {...context('large.ipynb', notebook, { truncated: true })} />,
    );
    await waitFor(() =>
      expect(large.container.textContent).toContain('larger than the 4 MB preview limit'),
    );
  });
});

const calendar = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Team',
  'BEGIN:VEVENT',
  'DTSTART:20261103T093000Z',
  'DTEND:20261103T100000Z',
  'SUMMARY:Stand-up',
  'LOCATION:Room 4\\, Floor 2',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261102',
  'DTEND;VALUE=DATE:20261103',
  'SUMMARY:Offsite',
  'END:VEVENT',
  'BEGIN:VTODO',
  'SUMMARY:Book rooms',
  'STATUS:COMPLETED',
  'END:VTODO',
  'END:VCALENDAR',
].join('\r\n');

const contacts = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Ana Pop',
  'ORG:Plurid',
  'TITLE:Engineer',
  'item1.EMAIL;type=INTERNET:ana@example.com',
  'item1.X-ABLabel:_$!<Work>!$_',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:4.0',
  'FN:Ion Rusu',
  'TEL;TYPE=cell:+40 721 000 111',
  'END:VCARD',
].join('\r\n');

describe('calendar and contacts preview', () => {
  it('lists events in start order and tasks briefly', async () => {
    const view = show(CardsPreview, 'team.ics', calendar);
    await waitFor(() => expect(view.getByRole('heading', { name: 'Team' })).toBeTruthy());
    const summaries = [...view.container.querySelectorAll('.calendar-what > strong')];
    expect(summaries.map((item) => item.textContent)).toEqual(['Offsite', 'Stand-up']);
    expect(view.getByText('All day')).toBeTruthy();
    expect(view.getByText('Room 4, Floor 2')).toBeTruthy();
    expect(view.getByText('Book rooms').className).toBe('is-done');
    expect(view.getByText('2 events · 1 task')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Calendar' })).toBeTruthy();
  });

  it('shows one card per contact with labelled values', async () => {
    const view = show(CardsPreview, 'people.vcf', contacts);
    await waitFor(() => expect(view.getByRole('article', { name: 'Ana Pop' })).toBeTruthy());
    expect(view.getByRole('article', { name: 'Ion Rusu' })).toBeTruthy();
    expect(view.getByText('Engineer, Plurid')).toBeTruthy();
    expect(view.getByText('ana@example.com').parentElement?.textContent).toBe(
      'ana@example.com · Work',
    );
    expect(view.getByText('+40 721 000 111')).toBeTruthy();
    expect(view.getByText('2 contacts')).toBeTruthy();
  });

  it('shows a genomic VCF file as text without a document view', async () => {
    const variants =
      '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\n20\t14370\trs6054257\tG\tA\n';
    const view = show(CardsPreview, 'calls.vcf', variants);
    await waitFor(() =>
      expect(view.getByLabelText('File text').textContent).toContain('rs6054257'),
    );
    expect(view.queryByRole('button', { name: 'Contacts' })).toBeNull();
    expect(view.container.querySelector('.inline-warning')).toBeNull();
  });
});

const srt = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  '<i>Hello</i> there',
  '',
  '2',
  '00:00:05,000 --> 00:01:02,500',
  'General Kenobi',
  '',
].join('\n');

describe('subtitles preview', () => {
  it('shows cues in a searchable table with their count and duration', async () => {
    const view = show(SubtitlesPreview, 'episode.srt', srt);
    await waitFor(() => expect(view.getByText('Hello there')).toBeTruthy());
    expect(view.getByText('2 cues · 1:02')).toBeTruthy();
    const rows = view.getAllByRole('row');
    expect(rows[0]!.textContent).toBe('#StartEndText');
    expect(rows[2]!.textContent).toBe('200:00:05.00000:01:02.500General Kenobi');
    fireEvent.change(view.getByRole('searchbox', { name: 'Search cues' }), {
      target: { value: 'kenobi' },
    });
    await waitFor(() => expect(view.queryByText('Hello there')).toBeNull());
    expect(view.getByRole('status').textContent).toBe('1 of 2 cues');
    expect(view.container.querySelector('mark')?.textContent).toBe('Kenobi');
  });

  it('opens Source at a search result line', async () => {
    const found = context('episode.srt', srt);
    found.evidence = {
      path: found.resource.entry.path,
      version: { size: srt.length, modified: 1, identity: '1:1' },
      anchor: { kind: 'text', line: 7, start: 0, end: 7 },
      quote: 'General Kenobi',
    };
    const view = render(<SubtitlesPreview {...found} />);
    await waitFor(() =>
      expect(view.container.querySelector('.evidence-line')?.textContent).toContain('General'),
    );
    expect(view.getByRole('button', { name: 'Source' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a file without timed cues as text with a note', async () => {
    const view = show(SubtitlesPreview, 'empty.srt', 'just words\n');
    await waitFor(() => expect(view.container.textContent).toContain('No timed cues were found'));
  });
});
