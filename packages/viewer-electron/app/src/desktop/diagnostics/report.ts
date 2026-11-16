import { app, screen } from 'electron';
import { execFile } from 'node:child_process';
import { open, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { redactReport } from '../../domain/diagnostics/report-redaction';
import type { ReportPrivateValue } from '../../domain/diagnostics/report-redaction';
import type { InstalledRelease } from '../../domain/updates/feed';
import type { LicenseStatus } from '../../domain/license/license';
import { realHome } from '../native/home';
import { installedRelease } from '../windows/about';

const exec = promisify(execFile);
export const reportLimits = { bytes: 1024 * 1024, failures: 20, message: 2000 } as const;
const failureKinds = new Set([
  'main-exception',
  'main-rejection',
  'main-error',
  'service-error',
  'renderer-error',
  'renderer-gone',
  'renderer-unresponsive',
  'process-gone',
  'worker-output',
]);

export interface ReportFacts {
  release: InstalledRelease;
  edition: 'direct' | 'Mac App Store';
  license: 'trial' | 'licensed';
  macOS: string | undefined;
  model: string | undefined;
  chip: string | undefined;
  memory: number | undefined;
  scales: number[];
  language: string | undefined;
  region: string | undefined;
}

export interface ReportInput {
  facts: ReportFacts;
  privateValues: ReportPrivateValue[];
  log: string | undefined;
}

/** Only these fields leave the desktop, after the failure text passes all privacy checks. */
export function diagnosticReport(input: ReportInput): string {
  const { facts, privateValues } = input;
  const unchecked = [
    ...new Set(privateValues.filter((item) => !item.value?.trim()).map((item) => item.kind)),
  ];
  const fact = (value: string | undefined) =>
    value
      ? redactReport(
          value,
          privateValues.filter((item) => item.value?.trim()),
        )
          .replace(/[\u0000-\u001f]/g, ' ')
          .trim()
      : 'unavailable';
  const lines = [
    '# Viewer report',
    '',
    `- Viewer: ${fact(facts.release.version)}`,
    `- Build: ${facts.release.build ?? 'development'}`,
    `- Edition: ${facts.edition}`,
    `- License: ${facts.license}`,
    `- macOS: ${fact(facts.macOS)}`,
    `- Model: ${fact(facts.model)}`,
    `- Chip: ${fact(facts.chip)}`,
    `- Memory: ${facts.memory === undefined ? 'unavailable' : `${Math.round(facts.memory / 1024 ** 3)} GiB`}`,
    `- Displays: ${facts.scales.length}${facts.scales.length ? ` (${facts.scales.map((scale) => `${scale}×`).join(', ')})` : ''}`,
    `- Language: ${fact(facts.language)}`,
    `- Region: ${fact(facts.region)}`,
    '',
    '## Recent failures (newest first)',
    '',
  ];
  if (unchecked.length) {
    lines.push(`Could not check: ${unchecked.join(', ')}. Failure excerpts omitted.`);
  } else if (input.log === undefined) {
    lines.push('The diagnostic log could not be read.');
  } else {
    const entries: { at: string; kind: string; detail: string }[] = [];
    for (const line of input.log.split('\n')) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (
          typeof entry.at === 'string' &&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.at) &&
          Number.isFinite(Date.parse(entry.at)) &&
          typeof entry.kind === 'string' &&
          failureKinds.has(entry.kind) &&
          typeof entry.detail === 'string'
        )
          entries.push({ at: entry.at, kind: entry.kind, detail: entry.detail });
      } catch {
        // Partial or malformed entries cannot contribute arbitrary unverified fields.
      }
    }
    const recent = entries
      .toReversed()
      .toSorted((a, b) => b.at.localeCompare(a.at))
      .slice(0, reportLimits.failures);
    for (const entry of recent) {
      // Redact before bounding: truncation must not turn a complete secret into a visible prefix.
      const message = redactReport(entry.detail, privateValues)
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
        .slice(0, reportLimits.message);
      lines.push(
        `### ${entry.at} (${entry.kind})`,
        '',
        ...message.split('\n').map((line) => '> ' + line),
        '',
      );
    }
    if (!recent.length) lines.push('No failures recorded.');
  }
  return lines.join('\n').trimEnd() + '\n';
}

async function localValue(file: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec(file, args, { timeout: 2000, maxBuffer: 4096 });
    return stdout.trim() || undefined;
  } catch {
    // Command errors can contain the very identity that could not be checked.
    return undefined;
  }
}

function localFact<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

async function logTail(file: string): Promise<string | undefined> {
  try {
    const handle = await open(file, 'r');
    try {
      const { size } = await handle.stat({ bigint: true });
      if (size > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
      const offset = Math.max(0, Number(size) - reportLimits.bytes);
      const buffer = Buffer.alloc(reportLimits.bytes);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const text = buffer.toString('utf8', 0, bytesRead);
      return offset ? text.slice(text.indexOf('\n') + 1) : text;
    } finally {
      await handle.close();
    }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : undefined;
  }
}

export async function makeDiagnosticReport(
  file: string,
  license: LicenseStatus | undefined,
): Promise<string> {
  const [fullName, computer, localHost, model, chip, volumes, log] = await Promise.all([
    localValue('/usr/bin/id', ['-F']),
    localValue('/usr/sbin/scutil', ['--get', 'ComputerName']),
    localValue('/usr/sbin/scutil', ['--get', 'LocalHostName']),
    localValue('/usr/sbin/sysctl', ['-n', 'hw.model']),
    localValue('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
    readdir('/Volumes').catch(() => undefined),
    logTail(file),
  ]);
  const user = localFact(() => os.userInfo());
  const home = localFact(realHome);
  const privateValues: ReportPrivateValue[] = [
    { kind: 'home', value: home },
    { kind: 'home', value: user?.homedir },
    { kind: 'home', value: localFact(() => os.homedir()) },
    { kind: 'short name', value: user?.username },
    { kind: 'full name', value: fullName },
    { kind: 'computer name', value: computer },
    { kind: 'local host name', value: localHost },
    { kind: 'Bonjour name', value: localFact(() => os.hostname()) },
    { kind: 'Bonjour name', value: localHost ? localHost + '.local' : undefined },
    {
      kind: 'application bundle',
      value: localFact(() =>
        app.isPackaged ? path.resolve(process.execPath, '../../..') : app.getAppPath(),
      ),
    },
    { kind: 'application data', value: localFact(() => app.getPath('userData')) },
    ...(volumes?.map((value) => ({ kind: 'volume name' as const, value })) ?? [
      { kind: 'volume name' as const, value: undefined },
    ]),
  ];
  return diagnosticReport({
    privateValues,
    log,
    facts: {
      release: installedRelease(),
      edition: process.mas ? 'Mac App Store' : 'direct',
      license: process.mas || license?.kind === 'licensed' ? 'licensed' : 'trial',
      macOS: localFact(() => process.getSystemVersion()),
      model,
      chip,
      memory: localFact(() => os.totalmem()),
      scales: localFact(() => screen.getAllDisplays().map((display) => display.scaleFactor)) ?? [],
      language: localFact(() => app.getLocale()),
      region: localFact(() => app.getLocaleCountryCode()),
    },
  });
}
