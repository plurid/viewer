import type { ReportInput } from '../../src/desktop/diagnostics/report';

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
