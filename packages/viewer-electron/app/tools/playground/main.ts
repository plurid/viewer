import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePlayground } from './generate';
import type { PlaygroundOptions } from './types';

const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
export const defaultPlaygroundDirectory = path.resolve(repository, '../viewer-playground');

export function parseArguments(args: string[]): PlaygroundOptions | 'help' {
  let directory = defaultPlaygroundDirectory;
  let downloadSamples = true;
  let directoryChosen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return 'help';
    if (argument === '--offline') downloadSamples = false;
    else if (argument === '--directory') {
      const value = args[++index];
      if (directoryChosen || !value || !path.isAbsolute(value))
        throw new Error('--directory requires one absolute folder path.');
      directory = path.resolve(value);
      directoryChosen = true;
    } else throw new Error(`Unknown playground argument: ${argument}`);
  }
  return { directory, downloadSamples };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options === 'help') {
    console.log(`Usage: pnpm playground [--directory /absolute/path] [--offline]

Default folder: ${defaultPlaygroundDirectory}
First run downloads about 215 MiB of pinned RAW/video samples. --offline skips
missing downloads. Existing files and Git scenarios are preserved; no cleanup
or reset command is provided. Each run writes an immutable report.
`);
    return;
  }
  const { report, reportPath } = await generatePlayground(options, console.log);
  const counts = new Map<string, number>();
  for (const file of report.files) counts.set(file.state, (counts.get(file.state) ?? 0) + 1);
  console.log(`Playground: ${report.directory}`);
  console.log(`Preview formats present: ${report.coverage.present}/${report.coverage.formats}`);
  console.log([...counts].map(([state, count]) => `${count} ${state}`).join(', '));
  console.log(`Git scenarios: ${report.git.state}`);
  if (!report.git.ready)
    console.log('Git initialization is incomplete or unrecognized; existing files were preserved.');
  console.log(`Report: ${reportPath}`);
  const differences = report.files.filter((file) => file.state === 'modified');
  for (const difference of differences) console.log(`Preserved modified file: ${difference.path}`);
  if (report.coverage.missing.length)
    console.log(`Missing samples: ${report.coverage.missing.join(', ')}`);
  if (report.files.some((file) => file.state === 'unavailable')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
