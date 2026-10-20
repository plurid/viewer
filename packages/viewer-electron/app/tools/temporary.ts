/**
 * Temporary test and tool folders follow AGENTS.md: they are never permanently
 * deleted. Cleanup moves a folder this process created to the user Trash after
 * identity and location checks; any doubt keeps the folder and reports it.
 * VIEWER_TEST_PRESERVE=1 keeps everything, so removal can wait for the owner's
 * approval, and lists each kept path in `keptManifest`.
 */
import { execFile } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Synchronous node:fs keeps these checks independent of tests that mock node:fs/promises.
export const keptManifest = path.join(os.tmpdir(), 'viewer-kept-test-folders.log');
const owned = new Map<string, { dev: number; ino: number }>();
const preserve = () => process.env.VIEWER_TEST_PRESERVE === '1';

/** Resolve the parent only, so a symbolic link at `file` itself is never followed. */
function canonical(file: string): string {
  return path.join(realpathSync.native(path.dirname(path.resolve(file))), path.basename(file));
}
function temporaryParents(): string[] {
  const parents = new Set<string>();
  for (const parent of [os.tmpdir(), '/private/tmp'])
    try {
      parents.add(realpathSync.native(parent));
    } catch {
      // An unavailable parent cannot contain an owned folder.
    }
  return [...parents];
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
function gone(file: string): boolean {
  try {
    lstatSync(file);
    return false;
  } catch (error) {
    return missing(error);
  }
}
function keep(file: string, reason: string): void {
  console.warn(`Kept ${file} (${reason}). Move it to Trash yourself when it is no longer needed.`);
  try {
    appendFileSync(keptManifest, `${new Date().toISOString()}\t${file}\t${reason}\n`);
  } catch {
    // The warning above still names the kept folder.
  }
}
/** macOS ships /usr/bin/trash from version 14; Viewer also supports 13. */
const trashAvailable = () => process.platform === 'darwin' && existsSync('/usr/bin/trash');
function trashCommand(file: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile('/usr/bin/trash', ['-s', file], (error, _stdout, stderr) =>
      error ? reject(new Error(String(stderr).trim() || error.message)) : resolve(),
    ),
  );
}

/** Create a uniquely named folder owned by this process. */
export async function temporaryRoot(prefix: string, parent = os.tmpdir()): Promise<string> {
  if (!/^viewer-[\w.-]*-$/.test(prefix))
    throw new Error('Temporary folders use a "viewer-<name>-" prefix.');
  const root = mkdtempSync(path.join(parent, prefix));
  const info = lstatSync(root);
  owned.set(canonical(root), { dev: info.dev, ino: info.ino });
  // Listed as it is made: a folder a test never handed to `trashTemporary` (an extra root) was
  // kept unlisted, 657 of them in one session's runs (2026-10-20).
  if (preserve()) keep(root, 'VIEWER_TEST_PRESERVE=1');
  return root;
}

/** Create `directory` exclusively, with any missing parents, and own it like a temporary
 * root, so entries inside it can be removed as scenario steps. An app container profile is
 * one such folder. Cleanup keeps it, because it lies outside the system temporary folder. */
export async function ownedDirectory(directory: string): Promise<string> {
  mkdirSync(path.dirname(directory), { recursive: true });
  mkdirSync(directory);
  const info = lstatSync(directory);
  owned.set(canonical(directory), { dev: info.dev, ino: info.ino });
  if (preserve()) keep(directory, 'VIEWER_TEST_PRESERVE=1');
  return directory;
}

/** Move a folder created by `temporaryRoot` to the Trash. It never deletes and
 * keeps the folder when its identity, type or location is in doubt. */
export async function trashTemporary(root: string | undefined): Promise<void> {
  if (!root) return;
  let actual: string;
  try {
    actual = canonical(root);
  } catch (error) {
    if (!missing(error)) keep(root, (error as Error).message);
    return;
  }
  const identity = owned.get(actual);
  if (!identity) return keep(root, 'not created by temporaryRoot in this process');
  let info;
  try {
    info = lstatSync(actual);
  } catch (error) {
    if (missing(error)) owned.delete(actual);
    else keep(root, (error as Error).message);
    return;
  }
  if (!info.isDirectory()) return keep(root, 'no longer a directory');
  if (info.dev !== identity.dev || info.ino !== identity.ino)
    return keep(root, 'replaced after creation');
  if (
    !temporaryParents().includes(path.dirname(actual)) ||
    !path.basename(actual).startsWith('viewer-')
  )
    return keep(root, 'outside the system temporary folder');
  owned.delete(actual);
  // already listed when it was made
  if (preserve()) return;
  if (!trashAvailable()) return keep(root, 'no Trash command on this system');
  try {
    await trashCommand(actual);
  } catch (error) {
    return keep(root, 'Trash failed: ' + (error as Error).message);
  }
  if (!gone(actual)) keep(root, 'still present after Trash reported success');
}

/** Remove one entry inside an owned folder as a test scenario step. The entry
 * goes to the Trash, or with VIEWER_TEST_PRESERVE=1 or without a Trash command into a
 * separate kept folder; either way its path disappears. Failures throw, like `rm`. */
export async function trashFixtureEntry(file: string): Promise<void> {
  const actual = canonical(file);
  lstatSync(actual);
  if (![...owned.keys()].some((root) => actual.startsWith(root + path.sep)))
    throw new Error(`Refusing to remove ${file}: it is outside this run's temporary folders.`);
  if (preserve() || !trashAvailable()) {
    const holder = await temporaryRoot('viewer-removed-');
    renameSync(actual, path.join(holder, path.basename(actual)));
    owned.delete(canonical(holder));
    keep(holder, 'holds removed fixture entry ' + file);
    return;
  }
  await trashCommand(actual);
  if (!gone(actual)) throw new Error(`${file} is still present after moving it to Trash.`);
}
