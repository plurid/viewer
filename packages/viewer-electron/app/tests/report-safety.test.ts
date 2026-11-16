import { describe, expect, it, vi } from 'vitest';
import { diagnosticReport } from '../src/desktop/diagnostics/report';
import type { ReportInput } from '../src/desktop/diagnostics/report';
import { redactReport } from '../src/domain/diagnostics/report-redaction';

vi.mock('electron', () => ({ app: {}, screen: {} }));

export const hostileMessages = [
  "ENOENT: no such file or directory, open 'Documents/Medical Records/Diagnosis.pdf'",
  "EACCES: permission denied, scandir '/Users/Shared/Client Acme/Payroll 2026'",
  `SyntaxError: Unexpected token 'P', "Patient: Jo"... is not valid JSON`,
  'get https://intranet.example.com/wiki/Secret_Project',
  'env DB_PASSWORD=hunter2',
];

export function reportFixture(messages = hostileMessages): ReportInput {
  return {
    facts: {
      release: { version: '1.0.0', build: 123 }, edition: 'direct', license: 'trial',
      macOS: '15.1', model: 'Mac16,1', chip: 'Apple M4', memory: 16 * 1024 ** 3,
      scales: [2], language: 'en-GB', region: 'GB',
    },
    privateValues: [],
    log: messages.map((detail, index) => JSON.stringify({
      at: new Date(Date.UTC(2026, 10, 1, 12, index)).toISOString(),
      kind: 'renderer-error', detail,
    })).join('\n'),
  };
}

describe('default report privacy', () => {
  it('projects the hostile failures without copying any message content', () => {
    const report = diagnosticReport(reportFixture());
    expect(report).not.toMatch(/Documents|Medical|Diagnosis|Users|Shared|Acme|Payroll|Patient|Jo|Unexpected|intranet|Secret_Project|DB_PASSWORD|hunter2/);
    expect(report).toContain('- Code: ENOENT');
    expect(report).toContain('- Code: EACCES');
    expect(report).toContain('- Class: SyntaxError');
  });

  it('does not let arbitrary private message values influence the default projection', () => {
    let seed = 0x5eed;
    for (let index = 0; index < 200; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 'PrivatePerson' + seed.toString(36);
      for (const injected of [value, encodeURIComponent(value + ' sample'), value + '\u0000', '\\u0050' + value.slice(1)]) {
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
  });

  it('allows only known error names and bounded codes at the message start or in structured fields', () => {
    const input = reportFixture(['Error: context mentioned ENOENT and a private value']);
    expect(diagnosticReport(input)).not.toContain('Code:');
    input.log = JSON.stringify({
      at: '2026-11-01T12:00:00.000Z', kind: 'renderer-error', detail: 'private details',
      errorClass: 'PrivateCustomer', code: 'lower-case-secret',
    });
    expect(diagnosticReport(input)).toContain('- Class: Error');
    expect(diagnosticReport(input)).not.toMatch(/PrivateCustomer|lower-case-secret|Code:/);
    input.log = JSON.stringify({
      at: '2026-11-01T12:00:00.000Z', kind: 'service-error', detail: 'private details',
      errorClass: 'FileAccessRequired', code: 'VIEWER_ACCESS_REQUIRED',
    });
    expect(diagnosticReport(input)).toContain('- Class: FileAccessRequired\n- Code: VIEWER_ACCESS_REQUIRED');
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
    const report = diagnosticReport(input);
    expect(report).toContain('FolderService.list (Contents/Resources/main.cjs:12:3)');
    expect(report).toContain('Contents/Resources/renderer.cjs:2:1');
    expect(report).toContain('3 frames outside Viewer');
    expect(report).not.toMatch(/Patient|private label|Users|Acme|PrivateClient|node:internal/);
  });

  it('uses the source folder as the containment root in development', () => {
    const input = reportFixture(['Error: ignored\n    at FolderService.list (/Source/Viewer/src/desktop/folders.ts:8:2)']);
    input.bundleRoot = '/Source/Viewer/src';
    expect(diagnosticReport(input)).toContain('FolderService.list (desktop/folders.ts:8:2)');
    expect(diagnosticReport(input)).not.toContain('/Source');
  });
});
