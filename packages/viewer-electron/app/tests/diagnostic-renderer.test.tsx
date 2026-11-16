// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ErrorBoundary } from '../src/renderer/ui/primitives';
import { reportFailure } from '../src/domain/diagnostics/report-failure';
import type { DiagnosticInput } from '../src/domain/diagnostics/failure';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  { error: new TypeError('Private render document'), errorClass: 'TypeError', code: undefined },
  {
    error: Object.assign(new Error('Private render document'), { code: 'ENOENT' }),
    errorClass: 'Error',
    code: 'ENOENT',
  },
])(
  'records a React $errorClass with code $code and its safe renderer location',
  ({ error, errorClass, code }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const diagnosticReport = vi.fn(async (_failure: DiagnosticInput) => {});
    Object.assign(window, { viewer: { diagnosticReport } });
    error.stack =
      error.name +
      ': Private render document\n' +
      '    at Object.Private_Client (viewer-app://app/assets/index-B3.js:12:76)';
    function BrokenView(): never {
      throw error;
    }
    render(
      <ErrorBoundary>
        <BrokenView />
      </ErrorBoundary>,
    );
    expect(diagnosticReport).toHaveBeenCalledOnce();
    const captured = diagnosticReport.mock.calls[0]![0];
    expect(captured).toMatchObject({
      errorClass,
      code,
      stack: '    at Object.Private_Client (viewer-app://app/assets/index-B3.js:12:76)',
    });
    if (typeof captured === 'string') throw new Error('The renderer discarded its error fields.');
    expect(captured.detail).toContain('BrokenView');
    expect(reportFailure({ ...captured }, undefined, new Set(['ENOENT']))).toEqual({
      name: errorClass,
      code,
      frames: [{ path: 'assets/index-B3.js', line: 12, column: 76 }],
      outside: 0,
    });
  },
);

it('bounds a React component trace without leaving half an emoji', () => {
  const diagnosticReport = vi.fn(async (_failure: DiagnosticInput) => {});
  Object.assign(window, { viewer: { diagnosticReport } });
  const boundary = new ErrorBoundary({ children: null });
  const error = new TypeError('failure');
  error.stack = 'TypeError: failure';
  const prefix = error.stack + '\n';
  boundary.componentDidCatch(error, {
    componentStack: 'x'.repeat(7999 - prefix.length) + '😀',
  });
  const captured = diagnosticReport.mock.calls[0]![0];
  if (typeof captured === 'string') throw new Error('The renderer discarded its error fields.');
  expect(captured.detail).toHaveLength(7999);
  expect(() => encodeURIComponent(captured.detail)).not.toThrow();
});
