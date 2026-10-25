import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openPlayground, sha256 } from './files';
import { downloadSample } from './camera-raw';
import { conventionalNames, localSamples, playgroundReadme, remoteSamples } from './catalog';
import { seedGit } from './git';
import type { FileResult, PlaygroundOptions, PlaygroundReport } from './types';

export async function generatePlayground(
  options: PlaygroundOptions,
  progress: (message: string) => void = () => undefined,
): Promise<{ report: PlaygroundReport; reportPath: string }> {
  const files = await openPlayground(options.directory);
  const samples = await localSamples();
  const samplePaths = new Set(samples.map((sample) => sample.path));
  for (const remote of remoteSamples) {
    if (samplePaths.has(remote.path)) throw new Error(`Duplicate sample path: ${remote.path}`);
    samplePaths.add(remote.path);
  }
  if (new Set(samples.map((sample) => sample.path)).size !== samples.length)
    throw new Error('Duplicate local sample paths.');
  const manifest = {
    version: 1,
    generator: 'Viewer tools/playground',
    semantics:
      'Expected reference bytes and preview behavior. Presence is not decoder qualification.',
    conventionalNames,
    samples: [
      ...samples.map(({ bytes, ...sample }) => ({
        ...sample,
        sha256: sha256(bytes),
        size: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.length,
      })),
      ...remoteSamples,
    ].sort((left, right) => left.path.localeCompare(right.path, 'en')),
  };
  const results: FileResult[] = [];
  results.push(await files.put('README.md', playgroundReadme));
  results.push(await files.put('manifest.json', JSON.stringify(manifest, null, 2) + '\n'));
  for (const sample of samples) results.push(await files.put(sample.path, sample.bytes));
  for (const remote of remoteSamples) {
    const existing = await files.inspect(remote.path, remote.sha256);
    if (existing.state !== 'missing' || !options.downloadSamples) {
      results.push(existing);
      continue;
    }
    progress(
      `Downloading ${path.basename(remote.path)} (${(remote.size / 1024 / 1024).toFixed(1)} MiB)…`,
    );
    try {
      results.push(await files.put(remote.path, await downloadSample(remote)));
    } catch (error) {
      results.push({
        path: remote.path,
        state: 'unavailable',
        expectedSHA256: remote.sha256,
        detail: error instanceof Error ? error.message : String(error),
      });
      progress(`Preserved playground; sample unavailable: ${remote.path}`);
    }
  }
  progress('Checking the Git scenario directory…');
  const git = await seedGit(files);
  const allFormats = new Set(manifest.samples.flatMap((sample) => sample.formats));
  const presentPaths = new Set(
    results
      .filter(
        (result) =>
          result.state === 'created' || result.state === 'unchanged' || result.state === 'modified',
      )
      .map((result) => result.path),
  );
  const presentFormats = new Set(
    manifest.samples
      .filter((sample) => presentPaths.has(sample.path))
      .flatMap((sample) => sample.formats),
  );
  const report: PlaygroundReport = {
    version: 1,
    directory: files.root,
    files: results,
    git,
    coverage: {
      formats: allFormats.size,
      present: presentFormats.size,
      missing: [...allFormats].filter((format) => !presentFormats.has(format)).sort(),
    },
  };
  const reportName = `reports/${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`;
  await files.put(reportName, JSON.stringify(report, null, 2) + '\n');
  return { report, reportPath: path.join(files.root, reportName) };
}
