import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPlayground } from './files';
import { downloadSample } from './camera-raw';
import { qualificationSamples } from './qualification-samples';
import { remoteSamples } from './catalog';
import { parseArguments } from './main';
import type { FileResult, PlaygroundOptions } from './types';

/** Adds a separate pinned corpus and manifest; never rewrites the original
 * playground catalog or any reference bytes a user may have edited. */
export async function qualifyPlayground(options: PlaygroundOptions, progress = console.log) {
  const files = await openPlayground(options.directory),
    results: FileResult[] = [];
  for (const sample of qualificationSamples) {
    const existing = await files.inspect(sample.path, sample.sha256);
    if (existing.state !== 'missing' || !options.downloadSamples) {
      results.push(existing);
      continue;
    }
    progress(`Downloading qualification reference ${path.basename(sample.path)}…`);
    try {
      results.push(await files.put(sample.path, await downloadSample(sample)));
    } catch (error) {
      results.push({
        path: sample.path,
        state: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  results.push(
    await files.put(
      'qualification/manifest-v2.json',
      JSON.stringify(
        {
          version: 1,
          semantics:
            'Reference presence is separate from decoder qualification. See the recorded packaged acceptance report.',
          samples: qualificationSamples,
          existingImageMediaReferences: remoteSamples,
        },
        null,
        2,
      ) + '\n',
    ),
  );
  results.push(
    await files.put(
      'qualification/README-v2.md',
      '# Preview qualification references\n\nOriginal public PDFs, published EPUBs and application-authored Office regression documents, with pinned source URLs, sizes, SHA256 and licenses in manifest-v2.json. They complement the camera RAW photographs and Big Buck Bunny trailer in the playground. Office layout uses its local renderer; bounded Reading and Sheet views expose semantic text and saved cell values separately. EPUB references exercise chapters, illustrations, internal notes, Unicode links, search and reading restoration. Coverage remains format-specific. Reference scripts and macros never run.\n\nExisting files and the main playground manifest remain untouched. Modified references are reported and preserved. Generated reports are immutable.\n',
    ),
  );
  const report = { version: 1, directory: files.root, files: results },
    reportPath = `qualification/reports/${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`;
  await files.put(reportPath, JSON.stringify(report, null, 2) + '\n');
  return { report, reportPath: path.join(files.root, reportPath) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  if (options === 'help')
    console.log(
      'Usage: pnpm playground:qualify [--directory /absolute/path] [--offline]\nAdds pinned PDF, Office and EPUB qualification references and a separate manifest without overwriting existing files.',
    );
  else
    qualifyPlayground(options)
      .then(({ report, reportPath }) => {
        console.log(reportPath);
        for (const file of report.files) console.log(`${file.state}: ${file.path}`);
        if (
          report.files.some((file) => ['missing', 'unavailable', 'modified'].includes(file.state))
        )
          process.exitCode = 1;
      })
      .catch((error: Error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
