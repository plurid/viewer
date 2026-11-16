import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DiagnosticLog } from '../src/desktop/diagnostics/diagnostics';
import { diagnosticReport } from '../src/desktop/diagnostics/report';
import { redactReport } from '../src/domain/diagnostics/report-redaction';
import { redactSecrets } from '../src/desktop/diagnostics/failures';
import { reportFixture } from './support/report-fixtures';
import { temporaryRoot } from '../tools/temporary';
import type { ReportPrivateValue } from '../src/domain/diagnostics/report-redaction';

vi.mock('electron', () => ({ app: {}, screen: {} }));

const values: ReportPrivateValue[] = [
  { kind: 'home', value: '/Users/zoe' },
  { kind: 'home', value: '/Home/Zoë Sample' },
  { kind: 'short name', value: 'zoe' },
  { kind: 'full name', value: 'Zoë Sample' },
  { kind: 'computer name', value: 'Zoë’s MacBook Pro' },
  { kind: 'local host name', value: 'Zoes-MacBook-Pro' },
  { kind: 'Bonjour name', value: 'Zoes-MacBook-Pro.local' },
  { kind: 'volume name', value: 'Sample Disk' },
  { kind: 'application bundle', value: '/Applications/Viewer.app' },
  { kind: 'application data', value: '/Users/zoe/Library/Application Support/Viewer' },
];

describe('report privacy regressions', () => {
  it('never infers a code from a message, including uppercase private values at its start', () => {
    for (let index = 0; index < 250; index++) {
      const privateValue = 'PRIVATE_CLIENT_' + index;
      for (const prefix of ['', 'Error: ', 'TypeError: ']) {
        const input = reportFixture([prefix + privateValue + ' is not supported']);
        const baseline = diagnosticReport(reportFixture(['Error: ignored']));
        const report = diagnosticReport(input);
        expect(report).not.toContain(privateValue);
        expect(report.replace('Class: TypeError', 'Class: Error')).toBe(baseline);
        const entry = JSON.parse(input.log!);
        input.log = JSON.stringify({ ...entry, code: privateValue, errorClass: privateValue });
        expect(diagnosticReport(input)).toBe(baseline);
      }
    }
    expect(diagnosticReport(reportFixture(['Error: ZOE_PASSPORT is not an image.']))).not.toContain('ZOE_PASSPORT');
  });

  it('records real error metadata and excludes message-injected frames and computed function names', async () => {
    const root = await temporaryRoot('viewer-report-structured-');
    const log = new DiagnosticLog(path.join(root, 'diagnostics.log'));
    const error = Object.assign(new TypeError('Private patient\n    at Medical.Diagnosis.Zoe (/Applications/Viewer.app/private.ts:1:2)'), { code: 'ENOENT' });
    error.stack = error.name + ': ' + error.message + '\n    at Object.Payroll_Acme_2026 (/Applications/Viewer.app/Contents/main.cjs:10:20)';
    await log.record('main-exception', error);
    const stored = await readFile(log.file, 'utf8');
    const entry = JSON.parse(stored);
    expect(entry.errorClass).toBe('TypeError');
    expect(entry.code).toBe('ENOENT');
    expect(entry.stack).not.toContain('private.ts');
    const report = diagnosticReport({ ...reportFixture(), log: stored, bundleRoot: '/Applications/Viewer.app' });
    expect(report).toContain('- Class: TypeError\n- Code: ENOENT');
    expect(report).toContain('Contents/main.cjs:10:20');
    expect(report).not.toMatch(/Medical|Diagnosis|Zoe|Payroll|Acme|private\.ts/);
  });

  it.each([
    ['open /Volumes/Sample Disk/Confidential/Payroll.xlsx', /Sample|Disk|Confidential|Payroll/],
    ['open /Users/Shared/zoe/Medical/Diagnosis.pdf', /zoe|Medical|Diagnosis/],
    ['open ~zoe/Medical Records/Diagnosis.pdf', /zoe|Medical|Diagnosis/],
    ['path=/Home/Zoë+Sample/Medical+Records/Diagnosis.pdf', /Zoë|Sample|Medical|Diagnosis/],
    ['cache -Users-zoe-Tax-2025 Users_zoe_Documents_Payroll', /zoe|Tax|Documents|Payroll/],
    ['open /Volumes/Sample Disk/Medical\rRecords/Diagnosis.pdf', /Medical|Records|Diagnosis/],
    ['open Documents/Medical/Diagnosis.pdf', /Documents|Medical|Diagnosis/],
    ['GET /Applications/Viewer.app/0123456789abcdef0123456789abcdef', /0123456789abcdef/],
    ['GET <Viewer>/0123456789abcdef0123456789abcdef', /0123456789abcdef/],
    ['GET <Viewer>/x/intranet.corp.example.com', /intranet|corp|example/],
    ['zoeMacBook zoesmacbook Zoës MacBook Pro Zoes_MacBook_Pro ZoesMacBookPro', /zoe|zoë|MacBook/i],
    ['connect 192.168.1.20:445', /192\.168/],
    ['Error: connect ECONNREFUSED 192.168.1.20:445', /192\.168/],
    ['connect 2001:0db8:85a3:0000:0000:8a2e:0370:7334', /85a3|7334/],
    ['connect [fe80::1c2d:3e4f:5a6b:7c8d%25en0]:445', /fe80|7c8d|en0/],
    ['mount smb:/nas/Finance', /nas|Finance/],
    ['connect intranet:8080 ip-10-0-12-7', /intranet|10-0-12-7/],
    ['ether A4-83-E7-12-34-56', /A4-83-E7/],
    ['to smith(at)example.com', /smith|example/],
    ['key glpat-AbCdEfGhIjKlMnOpQrSt', /AbCdEfGh/],
    ['key 0123456789abcdef0123', /0123456789abcdef/],
    ['MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\nq8sT4vXyZ0aB1cD2eF3g==', /q8sT4vXy/],
    ['id L1VzZXJzL3pvZQ==', /L1VzZXJzL3pvZQ/],
    ['load data:text/plain,Medical leave notes', /Medical|leave|notes/],
    ['Error: x\n    at connect 192.168.1.20 intranet.corp.example.com', /192\.168|intranet|corp/],
  ] as const)('removes the confirmed optional survivor: %s', (input, privateText) => {
    expect(redactReport(input, values)).not.toMatch(privateText);
  });

  it.each(['=', ':', '[', '{', ',', '|', '<', '«'])('recognizes a path after %s', (separator) => {
    expect(redactReport('source' + separator + '/Users/Shared/Acme/Payroll.xlsx', values)).not.toMatch(/Acme|Payroll|Shared/);
  });

  it.each([',', ';', ')', '@', '#'])('does not end a path at %s', (punctuation) => {
    expect(redactReport('open /Users/Shared/Smith' + punctuation + 'Jones/Payroll.xlsx', values)).not.toMatch(/Smith|Jones|Payroll/);
  });

  it.each([
    ['Straße', 'STRASSE'],
    ['İsmail', 'İSMAİL'],
  ])('folds the private name %s', (name, spelling) => {
    expect(redactReport(spelling, [{ kind: 'full name', value: name }])).not.toContain(spelling);
  });

  it('preserves readable log text while recognizing secrets across joining characters', () => {
    expect(redactSecrets('line one\nline two')).toBe('line one\nline two');
    expect(redactSecrets('می‌خواهم')).toBe('می‌خواهم');
    expect(redactSecrets('می‌خواهم DB_PASS\u200cWORD=hunter2')).not.toContain('hunter2');
    expect(redactSecrets('token="ab\u200dcd" next')).toBe('token=[redacted] next');
  });
});
