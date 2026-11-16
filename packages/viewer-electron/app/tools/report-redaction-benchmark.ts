import { performance } from 'node:perf_hooks';
import { redactReport } from '../src/domain/diagnostics/report-redaction';
import { redactCredentials } from '../src/domain/diagnostics/secrets';
import type { ReportPrivateValue } from '../src/domain/diagnostics/report-redaction';

const values: ReportPrivateValue[] = [
  { kind: 'home', value: '/Home/Example' },
  { kind: 'full name', value: 'Example Person' },
  { kind: 'local host name', value: 'example-computer' },
  { kind: 'application bundle', value: '/Applications/Viewer.app' },
  { kind: 'application data', value: '/Home/Example/Library/Application Support/Viewer' },
];
const measurements: unknown[] = [];
for (const size of [8000, 64000]) {
  for (const [name, seed] of [
    ['long word', 'a'],
    ['dotted word', 'a.'],
    ['wrapped licenses', 'viewer-license-1. '],
    ['quoted assignments', 'DB_PASSWORD="private words" '],
    ['newlines', '\n'],
    ['punctuated words', 'a|'],
    ['colons', ':'],
  ]) {
    const input = seed!.repeat(Math.ceil(size / seed!.length)).slice(0, size);
    for (let warmup = 0; warmup < 5; warmup++) {
      redactReport(input, values);
      redactCredentials(input);
    }
    const timings: number[] = [];
    for (let round = 0; round < 50; round++) {
      const start = performance.now();
      redactReport(input, values);
      redactCredentials(input);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    measurements.push({
      inputCharacters: size,
      case: name,
      medianMs: timings[25],
      p95Ms: timings[47],
      maximumMs: timings[49],
    });
  }
}
process.stdout.write(
  JSON.stringify(
    { inputBudget: 8000, rounds: 50, includes: 'report and log secret redaction', measurements },
    null,
    2,
  ) + '\n',
);
