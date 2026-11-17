import type { FolderProbe, FolderProbeResult } from '../../domain/workspaces/folder-facts';
import type { FoundRootContext } from '../../domain/workspaces/found/roots';
import { allowedFoundFolder } from '../../domain/workspaces/found/roots';
import { foundPathHash } from '../../domain/workspaces/found/keys';
import { itemIdentity, sameIdentity } from '../../domain/files/item-identity';
import { folderMarkerNames } from '../../domain/workspaces/folder-facts';
import type { FolderFacts } from './folder-facts';

export type FoundProbeValue = Omit<FolderProbe, 'ok' | 'identity'> & { identity: string };
export interface FoundProbeRecord {
  folder: string;
  at: number;
  expires?: number;
  value: FoundProbeValue;
}
interface ProbeInput {
  facts: Pick<FolderFacts, 'pass' | 'probe'> & Partial<Pick<FolderFacts, 'identity'>>;
  records: readonly FoundProbeRecord[];
  folders: readonly string[];
  verify?: readonly string[];
  context: FoundRootContext;
  access?(folder: string): boolean;
  now(): number;
  signal: AbortSignal;
}
export interface FoundProbePass {
  cache: Map<string, FoundProbeRecord>;
  facts: Map<string, FoundProbeValue>;
  fresh: Set<string>;
  missing: Set<string>;
  unknown: Set<string>;
  readonly exhausted: boolean;
  read(folder: string, force?: boolean): Promise<boolean>;
}
const week = 7 * 86_400_000;
const day = 86_400_000;
const fixedMarkers = new Set<string>(folderMarkerNames);

export function foundProbeExpiry(record: FoundProbeRecord): number {
  return (
    record.expires ?? record.at + week - (Number.parseInt(foundPathHash(record.folder), 16) % day)
  );
}

function interrupted(
  request: Promise<FolderProbeResult>,
  signal: AbortSignal,
): Promise<FolderProbeResult | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const cancel = () => resolve(undefined);
    signal.addEventListener('abort', cancel, { once: true });
    request
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', cancel))
      .catch(() => {});
  });
}

export async function probeFoundFolders(input: ProbeInput): Promise<FoundProbePass> {
  const cache = new Map(input.records.map((record) => [record.folder, record]));
  const facts = new Map<string, FoundProbeValue>();
  const fresh = new Set<string>();
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const pass = input.facts.pass();
  let reads = 0;
  const allowed = (folder: string) =>
    allowedFoundFolder(folder, input.context) && (!input.access || input.access(folder));
  for (const record of input.records)
    if (allowed(record.folder) && allowed(record.value.path))
      facts.set(record.folder, record.value);

  const read = async (folder: string, force = false): Promise<boolean> => {
    if (input.signal.aborted || !allowed(folder)) return false;
    const previous = cache.get(folder);
    if (!force && previous && foundProbeExpiry(previous) > input.now()) return true;
    if (reads >= 300 || pass.exhausted) return false;
    reads++;
    let result: FolderProbeResult | undefined;
    try {
      // FolderFacts times active reads, so an interactive request ahead of this probe is harmless.
      result = await interrupted(input.facts.probe(folder, pass), input.signal);
    } catch {
      unknown.add(folder);
      return false;
    }
    if (!result || input.signal.aborted) return false;
    if (!result.ok) {
      if (result.reason === 'missing' || result.reason === 'not-regular') {
        missing.add(folder);
        cache.delete(folder);
        facts.delete(folder);
      } else unknown.add(folder);
      return true;
    }
    if (
      !allowedFoundFolder(result.path, input.context) ||
      (input.access && !input.access(result.path))
    ) {
      unknown.add(folder);
      cache.delete(folder);
      facts.delete(folder);
      return true;
    }
    const at = input.now();
    const record: FoundProbeRecord = {
      folder,
      at,
      expires: at + week - (Number.parseInt(foundPathHash(folder), 16) % day),
      value: {
        path: result.path,
        markers: [
          ...result.markers.filter((name) => fixedMarkers.has(name)),
          ...result.markers.filter((name) => !fixedMarkers.has(name)),
        ].slice(0, 100),
        identity: itemIdentity(result.identity),
        capped: result.capped,
        git: result.git,
        package: result.package,
      },
    };
    cache.set(folder, record);
    facts.set(folder, record.value);
    fresh.add(folder);
    unknown.delete(folder);
    missing.delete(folder);
    return true;
  };
  // Oldest stale observations get the next budget, rather than expiring as one catalog-wide batch.
  const folders = [...new Set(input.folders)].sort(
    (a, b) => (cache.get(a)?.at ?? -Infinity) - (cache.get(b)?.at ?? -Infinity),
  );
  for (const folder of folders) {
    if (input.signal.aborted || reads >= 300 || pass.exhausted) break;
    await read(folder);
  }
  // Identity-only checks catch swaps while marker bodies remain cached. They share the same budget.
  for (const folder of new Set(input.verify)) {
    if (input.signal.aborted || reads >= 300 || pass.exhausted) break;
    const previous = facts.get(folder);
    if (!previous || fresh.has(folder) || !allowed(folder)) continue;
    reads++;
    let result: FolderProbeResult | undefined;
    try {
      result = await interrupted(
        input.facts.identity?.(folder, pass) ?? input.facts.probe(folder, pass),
        input.signal,
      );
    } catch {
      unknown.add(folder);
      continue;
    }
    if (!result || input.signal.aborted) break;
    if (!result.ok) {
      if (result.reason === 'missing' || result.reason === 'not-regular') {
        missing.add(folder);
        cache.delete(folder);
        facts.delete(folder);
      } else unknown.add(folder);
      continue;
    }
    if (
      result.path !== previous.path ||
      !sameIdentity(itemIdentity(result.identity), previous.identity)
    ) {
      if (!(await read(folder, true))) unknown.add(folder);
    }
  }
  return {
    cache,
    facts,
    fresh,
    missing,
    unknown,
    read,
    get exhausted() {
      return reads >= 300 || pass.exhausted;
    },
  };
}
