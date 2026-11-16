import { describe, expect, it, vi } from 'vitest';
import { diagnosticReport } from '../src/desktop/diagnostics/report';
import { redactReport } from '../src/domain/diagnostics/report-redaction';
import { diagnosticFailure } from '../src/domain/diagnostics/failure';

vi.mock('electron', () => ({ app: {}, screen: {} }));

import { reportFixture } from './support/report-fixtures';

describe('default report privacy', () => {
  it('projects the hostile failures without copying any message content', () => {
    const report = diagnosticReport(reportFixture());
    expect(report).not.toMatch(
      /Documents|Medical|Diagnosis|Users|Shared|Acme|Payroll|Patient|Jo|Unexpected|intranet|Secret_Project|DB_PASSWORD|hunter2/,
    );
    expect(report).not.toContain('- Code:');
    expect(report).toContain('- Class: Error');
  });

  it('does not let arbitrary private message values influence the default projection', () => {
    let seed = 0x5eed;
    for (let index = 0; index < 200; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 'PrivatePerson' + seed.toString(36);
      for (const injected of [
        value,
        encodeURIComponent(value + ' sample'),
        value + '\u0000',
        '\\u0050' + value.slice(1),
      ]) {
        const output = diagnosticReport(reportFixture(['Error: quoted content ' + injected]));
        expect(output).not.toContain(injected);
        expect(output).not.toContain(value);
        expect(output).toBe(diagnosticReport(reportFixture(['Error: ignored'])));
      }
    }
  });

  it('cannot reconstruct a private path by stripping controls after redaction', () => {
    const detail = 'open /Users/z\u0000oe/Medical Records/Diagnosis.mp4';
    expect(diagnosticReport(reportFixture([detail]))).not.toContain('Medical');
    expect(redactReport(detail, [{ kind: 'home', value: '/Users/zoe' }])).not.toContain('Medical');
    expect(redactReport('Hello Zo\u0000ë', [{ kind: 'full name', value: 'Zoë' }])).toBe(
      'Hello <private>',
    );
  });

  it('allows only known structured error names and codes', () => {
    const input = reportFixture(['Error: context mentioned ENOENT and a private value']);
    expect(diagnosticReport(input)).not.toContain('Code:');
    input.log = JSON.stringify({
      at: '2026-11-01T12:00:00.000Z',
      kind: 'renderer-error',
      detail: 'private details',
      errorClass: 'PrivateCustomer',
      code: 'lower-case-secret',
    });
    expect(diagnosticReport(input)).toContain('- Class: Error');
    expect(diagnosticReport(input)).not.toMatch(/PrivateCustomer|lower-case-secret|Code:/);
    input.log = JSON.stringify({
      at: '2026-11-01T12:00:00.000Z',
      kind: 'service-error',
      detail: 'private details',
      errorClass: 'FileAccessRequired',
      code: 'FILE_ACCESS_REQUIRED',
    });
    expect(diagnosticReport(input)).toContain(
      '- Class: FileAccessRequired\n- Code: FILE_ACCESS_REQUIRED',
    );
  });

  it('shows only contained bundle frames and counts every other frame without quoting it', () => {
    const input = reportFixture([
      'TypeError: private Patient content\n' +
        '    at FolderService.list (/Applications/Viewer.app/Contents/Resources/main.cjs:12:3)\n' +
        '    at private label (file:///Applications/Viewer.app/Contents/Resources/renderer.cjs:2:1)\n' +
        '    at outside (/Users/Shared/Client Acme/private.js:1:1)\n' +
        '    at traversal (/Applications/Viewer.app/../PrivateClient/file.js:1:1)\n' +
        '    at node:internal/main:20:2',
    ]);
    input.bundleRoot = '/Applications/Viewer.app';
    const entry = JSON.parse(input.log!);
    entry.stack = diagnosticFailure(
      Object.assign(new TypeError('private Patient content'), { stack: entry.detail }),
    ).stack;
    entry.errorClass = 'TypeError';
    input.log = JSON.stringify(entry);
    const report = diagnosticReport(input);
    expect(report).toContain('Contents/Resources/main.cjs:12:3');
    expect(report).toContain('Contents/Resources/renderer.cjs:2:1');
    expect(report).toContain('3 frames outside Viewer');
    expect(report).not.toMatch(
      /Patient|FolderService|private label|Users|Acme|PrivateClient|node:internal/,
    );
  });

  it('uses the source folder as the containment root in development', () => {
    const input = reportFixture([
      'Error: ignored\n    at FolderService.list (/Source/Viewer/src/desktop/folders.ts:8:2)',
    ]);
    input.bundleRoot = '/Source/Viewer/src';
    const entry = JSON.parse(input.log!);
    entry.stack = diagnosticFailure(
      Object.assign(new Error('ignored'), { stack: entry.detail }),
    ).stack;
    input.log = JSON.stringify(entry);
    expect(diagnosticReport(input)).toContain('desktop/folders.ts:8:2');
    expect(diagnosticReport(input)).not.toContain('/Source');
  });
});
