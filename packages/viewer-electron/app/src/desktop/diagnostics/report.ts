import { app, screen } from 'electron';
import { execFile } from 'node:child_process';
import { open, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { boundedText, withoutControls } from '../../domain/diagnostics/text';
import { reportFailure } from '../../domain/diagnostics/report-failure';
import { redactReport } from '../../domain/diagnostics/report-redaction';
import type { ReportPrivateValue } from '../../domain/diagnostics/report-redaction';
import type { ReportSnapshot } from '../../domain/diagnostics/report-window';
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
  bundleRoot?: string;
  includeMessageText?: boolean;
}

/** The default is a projection. Raw messages cross this boundary only after explicit opt-in. */
export function diagnosticReport(input: ReportInput): string {
  const { facts, privateValues } = input;
  const unchecked = input.includeMessageText
    ? [...new Set(privateValues.filter((item) => !item.value?.trim()).map((item) => item.kind))]
    : [];
  const fact = (value: string | undefined) =>
    value ? boundedText(withoutControls(value), 128).trim() : 'unavailable';
  const lines = [
    '# Viewer report',
    '',
    '- Viewer: ' + fact(facts.release.version),
    '- Build: ' + (facts.release.build ?? 'development'),
    '- Edition: ' + facts.edition,
    '- License: ' + facts.license,
    '- macOS: ' + fact(facts.macOS),
  ];
  if (facts.model) lines.push('- Model: ' + fact(facts.model));
  if (facts.chip) lines.push('- Chip: ' + fact(facts.chip));
  if (facts.memory !== undefined)
    lines.push('- Memory: ' + Math.round(facts.memory / 1024 ** 3) + ' GiB');
  lines.push(
    '- Displays: ' +
      facts.scales.length +
      (facts.scales.length ? ' (' + facts.scales.map((scale) => scale + '×').join(', ') + ')' : ''),
    '- Language: ' + fact(facts.language),
    '- Region: ' + fact(facts.region),
    '',
    '## Recent failures (newest first)',
    '',
  );
  if (unchecked.length)
    lines.push('Message text omitted: could not check ' + unchecked.join(', ') + '.', '');
  if (input.log === undefined) lines.push('The diagnostic log could not be read.');
  else {
    const entries: Record<string, unknown>[] = [];
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
          entries.push(entry);
      } catch {
        // Malformed records cannot supply any report field.
      }
    }
    const recent = entries
      .toReversed()
      .toSorted((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, reportLimits.failures);
    for (const entry of recent) {
      const failure = reportFailure(entry, input.bundleRoot, new Set(Object.keys(os.constants?.errno ?? {})));
      lines.push(
        '### ' + String(entry.at) + ' (' + String(entry.kind) + ')',
        '',
        '- Class: ' + failure.name,
      );
      if (failure.code) lines.push('- Code: ' + failure.code);
      for (const frame of failure.frames)
        lines.push('- ' + frame.path + ':' + frame.line + ':' + frame.column);
      if (failure.outside)
        lines.push(
          '- ' +
            failure.outside +
            (failure.outside === 1 ? ' frame' : ' frames') +
            ' outside Viewer',
        );
      if (input.includeMessageText && !unchecked.length) {
        const message = boundedText(
          redactReport(String(entry.detail), privateValues),
          reportLimits.message,
        );
        lines.push('', ...message.split('\n').map((line) => '> ' + line));
      }
      lines.push('');
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

async function reportPrivateValues(bundleRoot: string | undefined): Promise<ReportPrivateValue[]> {
  const user = localFact(() => os.userInfo());
  const home = localFact(realHome);
  const [fullName, computer, localHost, volumes, actualHome] = await Promise.all([
    localValue('/usr/bin/id', ['-F']),
    localValue('/usr/sbin/scutil', ['--get', 'ComputerName']),
    localValue('/usr/sbin/scutil', ['--get', 'LocalHostName']),
    readdir('/Volumes').catch(() => undefined),
    home ? realpath(home).catch(() => undefined) : undefined,
  ]);
  return [
    { kind: 'home', value: home },
    { kind: 'home', value: actualHome },
    { kind: 'home', value: user?.homedir },
    { kind: 'home', value: localFact(() => os.homedir()) },
    { kind: 'short name', value: user?.username },
    { kind: 'full name', value: fullName },
    { kind: 'computer name', value: computer },
    { kind: 'local host name', value: localHost },
    { kind: 'Bonjour name', value: localFact(() => os.hostname()) },
    { kind: 'Bonjour name', value: localHost ? localHost + '.local' : undefined },
    { kind: 'application bundle', value: bundleRoot },
    { kind: 'application data', value: localFact(() => app.getPath('userData')) },
    ...(volumes?.map((value) => ({ kind: 'volume name' as const, value })) ?? [
      { kind: 'volume name' as const, value: undefined },
    ]),
  ];
}

export async function makeDiagnosticReport(
  file: string,
  license: LicenseStatus | undefined,
  includeMessageText = false,
): Promise<string> {
  const snapshot = await makeDiagnosticReportSnapshot(file, license);
  return includeMessageText ? snapshot.withMessageText() : snapshot.report;
}

/** Both views share the same facts and log bytes; only explicit opt-in collects private values. */
export async function makeDiagnosticReportSnapshot(
  file: string,
  license: LicenseStatus | undefined,
): Promise<ReportSnapshot> {
  const bundleRoot = localFact(() =>
    app.isPackaged
      ? path.resolve(process.execPath, '../../..')
      : path.join(app.getAppPath(), 'src'),
  );
  const [model, chip, log] = await Promise.all([
    localValue('/usr/sbin/sysctl', ['-n', 'hw.model']),
    localValue('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
    logTail(file),
  ]);
  const input: ReportInput = {
    bundleRoot,
    privateValues: [],
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
  };
  let messages: Promise<string> | undefined;
  return {
    report: diagnosticReport(input),
    withMessageText: () => messages ??= reportPrivateValues(bundleRoot).then((privateValues) =>
      diagnosticReport({ ...input, privateValues, includeMessageText: true }),
    ),
  };
}
