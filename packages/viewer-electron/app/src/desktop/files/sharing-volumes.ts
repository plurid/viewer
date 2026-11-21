import path from 'node:path';
import { watch } from 'node:fs';
import type { SharingRunner } from './network-sharing';
import { macFiles } from '../native/macos-files';
import type { NativeSharingMount } from '../native/macos-files';

export type SharingVolumeKind = 'local' | 'network' | 'unknown';
export interface SharingVolumeSnapshot {
  mounts?: readonly NativeSharingMount[];
  precise: boolean;
}
function mountPath(file: string): string {
  return path
    .resolve(file)
    .replace(/^\/System\/Volumes\/Data(?=\/)/, '')
    .replace(/^\/private(?=\/(?:tmp|var|etc)(?:\/|$))/, '');
}
interface PreparedMount {
  path: string;
  folded: string;
  local: boolean;
}
const prepared = new WeakMap<SharingVolumeSnapshot, PreparedMount[]>();
function containsMount(parent: string, file: string): boolean {
  return parent === '/' || file === parent || file.startsWith(parent + '/');
}
export function parseSharingMounts(output: string): NativeSharingMount[] | undefined {
  if (!output.trim() || output.length > 1024 * 1024) return;
  const mounts: NativeSharingMount[] = [];
  const paths = new Set<string>();
  for (const line of output.trimEnd().split('\n')) {
    if (line.split(' on ').length !== 2) return;
    const match = /^.+ on (\/.*) \(([^()\r\n]+)\)$/.exec(line);
    if (!match || !match[1] || paths.has(match[1]) || mounts.length >= 2048) return;
    paths.add(match[1]);
    mounts.push({
      path: match[1],
      local: match[2]!.split(',').some((option) => option.trim() === 'local'),
    });
  }
  return mounts;
}
export function sharingVolume(file: string, snapshot: SharingVolumeSnapshot): SharingVolumeKind {
  if (!snapshot.mounts || (!snapshot.precise && /[\u0000-\u001f\u007f]/.test(file)))
    return 'unknown';
  const normalized = mountPath(file);
  let matches = prepared.get(snapshot);
  if (!matches) {
    matches = snapshot.mounts
      .map((mount) => {
        const path = mountPath(mount.path);
        return { path, folded: path.normalize('NFD').toLowerCase(), local: mount.local };
      })
      .sort((a, b) => b.path.length - a.path.length);
    prepared.set(snapshot, matches);
  }
  const mount = matches.find((mount) => containsMount(mount.path, normalized));
  if (!mount) return 'unknown';
  if (
    matches.some(
      (candidate) =>
        candidate.path.length > mount.path.length &&
        !candidate.local &&
        containsMount(candidate.folded, normalized.normalize('NFD').toLowerCase()),
    )
  )
    return 'unknown';
  if (mount.local) return 'local';
  // Text mount records do not escape names, so only kernel data can justify a negative answer.
  return snapshot.precise ? 'network' : 'unknown';
}
export class SharingVolumes {
  private cached?: { time: number; value: SharingVolumeSnapshot };
  private pending?: Promise<SharingVolumeSnapshot>;
  constructor(
    private readonly run: SharingRunner,
    private readonly native = () => macFiles().sharingMounts?.(),
    private readonly now = Date.now,
    private readonly changes = watchVolumeChanges,
  ) {}
  read(force = false): Promise<SharingVolumeSnapshot> {
    try {
      const mounts = this.native();
      if (
        mounts?.length &&
        mounts.every(
          (mount) =>
            typeof mount.path === 'string' &&
            path.isAbsolute(mount.path) &&
            !mount.path.includes('\0') &&
            typeof mount.local === 'boolean',
        )
      )
        return Promise.resolve({ mounts, precise: true });
    } catch {
      /* A legacy or absent helper uses a bounded read-only fallback. */
    }
    if (this.pending) return this.pending;
    if (!force && this.cached && this.now() - this.cached.time < 5000)
      return Promise.resolve(this.cached.value);
    this.pending = this.run('mounts')
      .then((output) => {
        const value = {
          mounts: output.ok ? parseSharingMounts(output.stdout) : undefined,
          precise: false,
        };
        this.cached = { time: this.now(), value };
        return value;
      })
      .catch(() => ({ precise: false }))
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  watch(changed: () => void): () => void {
    return this.changes(() => {
      this.cached = undefined;
      changed();
    });
  }
}

/** Mount notifications need no periodic process, including without the native helper. */
export function watchVolumeChanges(changed: () => void): () => void {
  if (process.platform !== 'darwin') return () => {};
  try {
    const watcher = watch('/Volumes', { persistent: false }, changed);
    watcher.on('error', () => {});
    return () => watcher.close();
  } catch {
    return () => {};
  }
}
