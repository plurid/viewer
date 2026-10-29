import { describe, expect, it } from 'vitest';
import { parseNotebook } from '../src/domain/previews/data/notebook';
import type { Notebook, NotebookLimits } from '../src/domain/previews/data/notebook';

// A one-pixel PNG, as Jupyter stores it: base64 with a line break.
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
    language_info: { name: 'python', file_extension: '.py', version: '3.12.4' },
  },
  cells: [
    {
      cell_type: 'markdown',
      id: 'intro',
      metadata: {},
      source: ['# Sales by region\n', '\n', 'Totals for **2026**. ![chart](attachment:chart.png)'],
      attachments: { 'chart.png': { 'image/png': `${pixel.slice(0, 40)}\n${pixel.slice(40)}` } },
    },
    {
      cell_type: 'code',
      execution_count: 3,
      id: 'load',
      metadata: {},
      source: 'import pandas as pd\nframe = pd.read_csv("sales.csv")\nframe.head()',
      outputs: [
        { output_type: 'stream', name: 'stdout', text: ['Loading\n', 'Loaded 1,204 rows\n'] },
        { output_type: 'stream', name: 'stdout', text: 'Done\n' },
        { output_type: 'stream', name: 'stderr', text: 'DeprecationWarning: old API\n' },
        {
          output_type: 'execute_result',
          execution_count: 3,
          metadata: {},
          data: {
            'text/html': ['<table><script>alert(1)</script></table>'],
            'text/plain': ['   region  total\n', '0  north    120'],
          },
        },
      ],
    },
    {
      cell_type: 'code',
      execution_count: 4,
      metadata: {},
      source: ['frame.plot()'],
      outputs: [
        {
          output_type: 'display_data',
          metadata: {},
          data: { 'image/png': pixel, 'text/plain': ['<Figure size 640x480 with 1 Axes>'] },
        },
        {
          output_type: 'display_data',
          metadata: {},
          data: { 'text/html': '<div onclick="steal()">Widget</div>' },
        },
      ],
    },
    {
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      source: 'for step in range(3): print(step)',
      outputs: [
        { output_type: 'stream', name: 'stdout', text: '\r 10%\r 50%\r100%\n' },
        {
          output_type: 'error',
          ename: 'ZeroDivisionError',
          evalue: 'division by zero',
          traceback: [
            `\u001b[0;31m${'-'.repeat(75)}\u001b[0m`,
            '\u001b[0;31mZeroDivisionError\u001b[0m: division by zero',
          ],
        },
      ],
    },
    { cell_type: 'raw', metadata: {}, source: '%%latex\n\\alpha' },
  ],
};

function read(value: unknown, limits?: NotebookLimits): Notebook {
  const reading = parseNotebook(JSON.stringify(value), limits);
  if (!reading.ok) throw new Error(reading.reason);
  return reading.notebook;
}

describe('notebook parser', () => {
  it('reads cells, kernel metadata and every supported output in order', () => {
    const parsed = read(notebook);
    expect(parsed).toMatchObject({
      format: '4.5',
      language: 'python',
      extension: 'py',
      kernel: 'Python 3 (ipykernel)',
      total: 5,
    });
    expect(parsed.cells.map((cell) => cell.kind)).toEqual([
      'markdown',
      'code',
      'code',
      'code',
      'raw',
    ]);
    const [markdown, load, plot, loop] = parsed.cells;
    expect(markdown!.source).toBe(
      '# Sales by region\n\nTotals for **2026**. ![chart](attachment:chart.png)',
    );
    expect(markdown!.attachments['attachment:chart.png']).toBe(`data:image/png;base64,${pixel}`);
    expect(load!.execution).toBe(3);
    expect(load!.outputs).toEqual([
      {
        kind: 'text',
        source: 'stdout',
        text: 'Loading\nLoaded 1,204 rows\nDone\n',
        truncated: false,
      },
      {
        kind: 'text',
        source: 'stderr',
        text: 'DeprecationWarning: old API\n',
        truncated: false,
      },
      // the plain-text form wins over HTML, which is never rendered
      {
        kind: 'text',
        source: 'result',
        text: '   region  total\n0  north    120',
        truncated: false,
      },
    ]);
    expect(plot!.outputs).toEqual([
      {
        kind: 'image',
        type: 'image/png',
        url: `data:image/png;base64,${pixel}`,
        alt: '<Figure size 640x480 with 1 Axes>',
      },
      { kind: 'html', source: '<div onclick="steal()">Widget</div>', truncated: false },
    ]);
    expect(loop!.execution).toBeUndefined();
    expect(loop!.outputs[0]).toMatchObject({ kind: 'text', text: '100%\n' });
    expect(loop!.outputs[1]).toEqual({
      kind: 'error',
      name: 'ZeroDivisionError',
      message: 'division by zero',
      traceback: '-'.repeat(75) + '\nZeroDivisionError: division by zero',
      truncated: false,
    });
  });

  it('tolerates missing fields and refuses what is not a format 4 notebook', () => {
    const sparse = read({ cells: [{ cell_type: 'code' }, 'not a cell', { source: 7 }] });
    expect(sparse.format).toBeUndefined();
    expect(sparse.language).toBeUndefined();
    expect(sparse.total).toBe(3);
    expect(sparse.cells).toEqual([
      {
        kind: 'code',
        source: '',
        truncated: false,
        execution: undefined,
        outputs: [],
        omittedOutputs: 0,
        attachments: {},
      },
      {
        kind: 'raw',
        source: '',
        truncated: false,
        execution: undefined,
        outputs: [],
        omittedOutputs: 0,
        attachments: {},
      },
    ]);
    expect(parseNotebook('{"cells": [')).toMatchObject({ ok: false });
    expect(parseNotebook('[]')).toEqual({
      ok: false,
      reason: 'The file is not a notebook object.',
    });
    expect(parseNotebook('{"nbformat": 3, "worksheets": []}')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('format 3'),
    });
    expect(parseNotebook('{"nbformat": 4}')).toEqual({
      ok: false,
      reason: 'The notebook has no cell list.',
    });
  });

  it('bounds cells, outputs, text and images, and checks image data', () => {
    const limits: NotebookLimits = { cells: 2, outputsPerCell: 2, text: 10, image: 20 };
    const many = read(
      {
        nbformat: 4,
        nbformat_minor: 2,
        cells: [
          {
            cell_type: 'code',
            source: 'x = "a long line of code"',
            outputs: [
              { output_type: 'stream', name: 'stdout', text: 'twelve chars' },
              { output_type: 'display_data', data: { 'image/png': pixel } },
              { output_type: 'display_data', data: { 'text/plain': 'third' } },
            ],
          },
          {
            cell_type: 'code',
            source: '',
            outputs: [
              { output_type: 'display_data', data: { 'image/jpeg': 'not base64!' } },
              { output_type: 'display_data', data: { 'application/vnd.widget+json': {} } },
            ],
          },
          { cell_type: 'markdown', source: 'beyond the limit' },
        ],
      },
      limits,
    );
    expect(many.total).toBe(3);
    expect(many.cells).toHaveLength(2);
    const [first, second] = many.cells;
    expect(first!.source).toBe('x = "a lon');
    expect(first!.truncated).toBe(true);
    expect(first!.omittedOutputs).toBe(1);
    expect(first!.outputs).toEqual([
      { kind: 'text', source: 'stdout', text: 'twelve cha', truncated: true },
      { kind: 'omitted', reason: 'An image output exceeds the preview limit.' },
    ]);
    expect(second!.outputs).toEqual([
      { kind: 'omitted', reason: 'An image output is not valid base64.' },
      { kind: 'omitted', reason: 'Output of type application/vnd.widget+json is not shown.' },
    ]);
  });
});
