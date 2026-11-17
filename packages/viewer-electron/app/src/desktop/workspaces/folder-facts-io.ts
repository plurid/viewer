import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import type {
  FolderFactsFailure,
  FolderRead,
  FolderProbeResult,
  FolderGitMarker,
} from '../../domain/workspaces/folder-facts';
import { folderFactsLimits, folderMarkerNames } from '../../domain/workspaces/folder-facts';
import { exactIdentityParts, itemIdentity } from '../../domain/files/item-identity';
import { containsPath } from '../files/containment';

function failure(error: unknown): FolderFactsFailure {
  const code = (error as NodeJS.ErrnoException).code;
  return { ok: false, reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable' };
}

// Synchronous reads stay in this disposable thread, outside the shared libuv filesystem pool.
export function readFolderFile(file: string, maxBytes: number, approvedPath?: string): FolderRead {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > folderFactsLimits.bytes)
    return { ok: false, reason: 'too-large' };
  let descriptor: number | undefined;
  try {
    const folder = realpathSync.native(path.dirname(file));
    const actual = realpathSync.native(file);
    if (approvedPath !== undefined && actual !== approvedPath)
      return { ok: false, reason: 'changed' };
    if (!containsPath(folder, actual)) return { ok: false, reason: 'outside-folder' };
    const observed = lstatSync(actual, { bigint: true });
    if (!observed.isFile()) return { ok: false, reason: 'not-regular' };
    if (observed.size > BigInt(maxBytes)) return { ok: false, reason: 'too-large' };
    descriptor = openSync(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) return { ok: false, reason: 'not-regular' };
    if (itemIdentity(before) !== itemIdentity(observed)) return { ok: false, reason: 'changed' };
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length > maxBytes) return { ok: false, reason: 'too-large' };
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(length) !== after.size
    )
      return { ok: false, reason: 'changed' };
    return { ok: true, path: actual, bytes: bytes.subarray(0, length) };
  } catch (error) {
    return failure(error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function probeFolder(
  folder: string,
  approvedPath?: string,
  permittedFiles?: ReadonlySet<string>,
  identityOnly = false,
): FolderProbeResult {
  try {
    lstatSync(folder);
    const actual = realpathSync.native(folder);
    if (approvedPath !== undefined && actual !== approvedPath)
      return { ok: false, reason: 'changed' };
    const info = lstatSync(actual, { bigint: true });
    if (!info.isDirectory()) return { ok: false, reason: 'not-regular' };
    // Cached roots need identity verification without another marker or manifest read.
    if (identityOnly)
      return {
        ok: true,
        path: actual,
        identity: exactIdentityParts(info),
        markers: [],
        capped: false,
      };
    const metadata = (name: string, maximum: number): FolderRead => {
      const file = path.join(actual, name);
      try {
        const resolved = realpathSync.native(file);
        if (permittedFiles && !permittedFiles.has(resolved)) return { ok: false, reason: 'scope' };
        return readFolderFile(file, maximum, resolved);
      } catch (error) {
        return failure(error);
      }
    };
    const markers = new Set<string>();
    const fixed = new Set<string>(folderMarkerNames);
    const directory = opendirSync(actual);
    let capped = false;
    try {
      let count = 0;
      while (count < folderFactsLimits.entries) {
        const entry = directory.readSync();
        if (!entry) break;
        count++;
        if (
          fixed.has(entry.name) ||
          (entry.isDirectory() && /\.(?:xcodeproj|xcworkspace)$/.test(entry.name))
        )
          markers.add(entry.name);
      }
      capped = count === folderFactsLimits.entries;
    } finally {
      directory.closeSync();
    }
    if (capped)
      for (const name of folderMarkerNames) {
        try {
          lstatSync(path.join(actual, name));
          markers.add(name);
        } catch {
          // A capped folder still reports fixed markers without continuing its directory scan.
        }
      }
    let git: FolderGitMarker | undefined;
    if (markers.has('.git')) {
      const item = lstatSync(path.join(actual, '.git'));
      if (item.isDirectory()) git = 'directory';
      else if (item.isFile()) {
        const read = metadata('.git', folderFactsLimits.gitBytes);
        if (read.ok) {
          const text = Buffer.from(read.bytes).toString('utf8');
          git = /\/worktrees\//.test(text)
            ? 'worktree'
            : /\/modules\//.test(text)
              ? 'submodule'
              : 'file';
        }
      }
    }
    let manifest: { name?: string; workspaces?: boolean; packageManager?: string } | undefined;
    if (markers.has('package.json')) {
      const read = metadata('package.json', folderFactsLimits.bytes);
      if (read.ok) {
        try {
          const value = JSON.parse(Buffer.from(read.bytes).toString('utf8'));
          if (value && typeof value === 'object')
            manifest = {
              name: typeof value.name === 'string' ? value.name.slice(0, 200) : undefined,
              workspaces:
                Array.isArray(value.workspaces) || Array.isArray(value.workspaces?.packages),
              packageManager:
                typeof value.packageManager === 'string'
                  ? value.packageManager.slice(0, 200)
                  : undefined,
            };
        } catch {
          // Invalid manifests remain markers but cannot supply project metadata.
        }
      }
    }
    if (itemIdentity(info) !== itemIdentity(lstatSync(actual, { bigint: true })))
      return { ok: false, reason: 'changed' };
    return {
      ok: true,
      path: actual,
      identity: exactIdentityParts(info),
      markers: [...markers],
      capped,
      git,
      package: manifest,
    };
  } catch (error) {
    return failure(error);
  }
}
