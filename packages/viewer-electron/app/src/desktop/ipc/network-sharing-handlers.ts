import type { ApiHandlers } from './schemas';
import type { NetworkSharing } from '../files/network-sharing';

interface SharingHandlerPorts {
  available: boolean;
  sharing: Pick<NetworkSharing, 'refresh' | 'snapshot' | 'inspect'>;
  isAgent(owner: number): boolean;
  requireFolder(file: string): Promise<void>;
  access?(file: string): Promise<void>;
  openSettings(): Promise<void>;
}

export function networkSharingFolderGuard(
  access: { require(files: readonly string[]): Promise<void> },
  sharing: Pick<NetworkSharing, 'requireFolder'>,
): (file: string) => Promise<void> {
  return async (file) => {
    await access.require([file]);
    await sharing.requireFolder(file);
  };
}

export function createNetworkSharingHandlers(
  ports: SharingHandlerPorts,
): Pick<ApiHandlers, 'networkSharing'> {
  return {
    networkSharing: async ([request], owner) => {
      if (ports.isAgent(owner)) throw new Error('Network sharing is available only to the person.');
      if (!ports.available)
        return { status: 'unavailable', shares: [], service: 'unknown', host: '', ipv4: [] };
      if (request.kind === 'refresh') {
        const allowed: string[] = [];
        const unknown: string[] = [];
        for (const file of request.paths ?? []) {
          try {
            await (ports.access ?? ports.requireFolder)(file);
            allowed.push(file);
          } catch {
            unknown.push(file);
          }
        }
        const snapshot = request.paths?.length
          ? await ports.sharing.inspect(allowed, request.force)
          : await ports.sharing.refresh(request.force);
        if (ports.isAgent(owner))
          throw new Error('Network sharing is available only to the person.');
        return unknown.length
          ? {
              ...snapshot,
              folders: [
                ...(snapshot.folders ?? []),
                ...unknown.map((path) => ({ path, status: 'unknown' as const, shares: [] })),
              ],
            }
          : snapshot;
      }
      await ports.requireFolder(request.path);
      if (ports.isAgent(owner)) throw new Error('Network sharing is available only to the person.');
      await ports.openSettings();
      return ports.sharing.snapshot();
    },
  };
}
