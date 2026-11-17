/**
 * The accepted captures every run is compared with. Accepting never deletes: a scene's previous
 * baseline moves into `baseline-retired/<time>/`, kept until the owner moves it to the Trash.
 */
import { copyFile, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { comparePictures, decodePNG, encodePNG } from './png';
import type { RunResults } from './types';

interface BaselineIndex {
  version: 1;
  /** For each scene, the run its accepted captures come from. */
  scenes: Record<string, { run: string; accepted: string }>;
}

const exists = (file: string) =>
  lstat(file).then(
    () => true,
    () => false,
  );

async function readIndex(baseline: string): Promise<BaselineIndex> {
  try {
    return JSON.parse(await readFile(path.join(baseline, 'index.json'), 'utf8')) as BaselineIndex;
  } catch {
    return { version: 1, scenes: {} };
  }
}

/** Compares each capture of the run with its accepted capture, writing the difference beside it. */
export async function compareWithBaseline(
  reviewRoot: string,
  runFolder: string,
  results: RunResults,
): Promise<void> {
  const baseline = path.join(reviewRoot, 'baseline');
  const index = await readIndex(baseline);
  for (const scene of results.scenes)
    for (const capture of scene.captures) {
      if (!capture.image) continue;
      const accepted = path.join(baseline, scene.id, capture.variant.id + '.png');
      const acceptedRun = index.scenes[scene.id]?.run;
      if (!acceptedRun || !(await exists(accepted))) continue;
      const before = decodePNG(await readFile(accepted));
      const after = decodePNG(await readFile(path.join(runFolder, capture.image)));
      const stem = path.join(scene.id, capture.variant.id);
      if (before.width !== after.width || before.height !== after.height) {
        await copyFile(accepted, path.join(runFolder, stem + '.baseline.png'));
        capture.baseline = { image: stem + '.baseline.png', sameSize: false, acceptedRun };
        continue;
      }
      const difference = comparePictures(before, after);
      if (difference.changed === 0) {
        capture.baseline = { changed: 0, sameSize: true, acceptedRun };
        continue;
      }
      await copyFile(accepted, path.join(runFolder, stem + '.baseline.png'));
      await writeFile(
        path.join(runFolder, stem + '.difference.png'),
        encodePNG(difference.picture),
        { flag: 'wx' },
      );
      capture.baseline = {
        image: stem + '.baseline.png',
        difference: stem + '.difference.png',
        changed: difference.changed,
        sameSize: true,
        acceptedRun,
      };
    }
}

/** Makes the run's captures the baseline for the scenes it captured. Returns the folder that now
 * holds the replaced baselines, when there were any. */
export async function acceptRun(
  reviewRoot: string,
  runFolder: string,
  results: RunResults,
): Promise<string | undefined> {
  const baseline = path.join(reviewRoot, 'baseline');
  const retired = path.join(
    reviewRoot,
    'baseline-retired',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(baseline, { recursive: true });
  const index = await readIndex(baseline);
  let moved = false;
  for (const scene of results.scenes) {
    const captures = scene.captures.filter((capture) => capture.image);
    if (!captures.length) continue;
    const target = path.join(baseline, scene.id);
    if (await exists(target)) {
      await mkdir(retired, { recursive: true });
      await rename(target, path.join(retired, scene.id));
      moved = true;
    }
    await mkdir(target);
    for (const capture of captures)
      await copyFile(
        path.join(runFolder, capture.image!),
        path.join(target, capture.variant.id + '.png'),
      );
    index.scenes[scene.id] = { run: results.run, accepted: new Date().toISOString() };
  }
  const indexFile = path.join(baseline, 'index.json');
  if (await exists(indexFile)) {
    await mkdir(retired, { recursive: true });
    await rename(indexFile, path.join(retired, 'index.json'));
    moved = true;
  }
  await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
  return moved ? retired : undefined;
}
