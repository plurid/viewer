import type { ApiHandlers } from './schemas';
import type { NetworkSharing } from '../files/network-sharing';

interface SharingHandlerPorts {
  available: boolean;
  sharing: Pick<NetworkSharing, 'refresh' | 'snapshot'>;
  isAgent(owner: number): boolean;
  requireFolder(file: string): Promise<void>;
  openSettings(): Promise<void>;
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
        const snapshot = await ports.sharing.refresh();
        if (ports.isAgent(owner))
          throw new Error('Network sharing is available only to the person.');
        return snapshot;
      }
      await ports.requireFolder(request.path);
      if (ports.isAgent(owner)) throw new Error('Network sharing is available only to the person.');
      await ports.openSettings();
      return ports.sharing.snapshot();
    },
  };
}
