import type { RemoteConnection } from '../../domain/remote/connections';
import type { SFTPAttributes, SFTPListingName } from './sftp/codec';
import { UtilityClient } from '../workers/utility-client';
import type { WorkerBackend } from '../workers/utility-client';
import type { RemoteLane } from './lanes';

export type { RemoteLane } from './lanes';

export type RemotePrimitive =
  | { type: 'home' }
  | { type: 'list'; path: string }
  | { type: 'stat'; path: string; follow?: boolean }
  | { type: 'realpath'; path: string }
  | { type: 'read'; path: string; offset: bigint; length: number }
  | { type: 'write'; path: string; bytes: Uint8Array; permissions?: number };

export type RemotePrimitiveReply =
  | { type: 'path'; path: string }
  | { type: 'list'; entries: SFTPListingName[]; truncated: boolean }
  | { type: 'stat'; attributes: SFTPAttributes }
  | { type: 'read'; bytes: Uint8Array }
  | { type: 'write'; bytes: bigint };

export interface RemoteSessionConfiguration {
  connection: RemoteConnection;
  controlPath: string;
  sshExecutable?: string;
}

export type RemoteMethods = {
  configure: { args: [configuration: RemoteSessionConfiguration]; reply: void };
  request: {
    args: [id: string, lane: RemoteLane, request: RemotePrimitive, thumbnail?: boolean];
    reply: RemotePrimitiveReply;
  };
  /** Closes the connection's channels but keeps it configured: the next request reopens them. */
  release: { args: [id: string]; reply: void };
  disconnect: { args: [id: string]; reply: void };
};

export interface RemoteSessionPort {
  configure(configuration: RemoteSessionConfiguration): Promise<void>;
  request(
    id: string,
    lane: RemoteLane,
    request: RemotePrimitive,
    signal?: AbortSignal,
    thumbnail?: boolean,
  ): Promise<RemotePrimitiveReply>;
  release(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  close(): Promise<void>;
}

/** One worker for all connections; idle construction launches no utility process. */
export class RemoteSessions implements RemoteSessionPort {
  private client: UtilityClient<RemoteMethods>;
  private configurations = new Map<string, RemoteSessionConfiguration>();

  /** `lost` hears of a channel that ended on its own, or of the worker itself ending. */
  constructor(worker: string, options: { backend?: WorkerBackend; lost(id: string): void }) {
    this.client = new UtilityClient(worker, {
      name: 'Viewer servers',
      backend: options.backend,
      initialize: async (client) => {
        for (const configuration of this.configurations.values()) {
          await client.post('configure', [configuration]);
        }
      },
      event: (event) => {
        if (
          event.event === 'remote-channel-lost' &&
          typeof event.value === 'string' &&
          this.configurations.has(event.value)
        ) {
          options.lost(event.value);
        }
      },
      stopped: () => {
        for (const id of this.configurations.keys()) {
          options.lost(id);
        }
      },
    });
  }

  async configure(configuration: RemoteSessionConfiguration): Promise<void> {
    this.configurations.set(configuration.connection.id, configuration);
    await this.client.call('configure', [configuration]);
  }

  request(
    id: string,
    lane: RemoteLane,
    request: RemotePrimitive,
    signal?: AbortSignal,
    thumbnail = false,
  ): Promise<RemotePrimitiveReply> {
    return this.client.call('request', [id, lane, request, thumbnail], signal);
  }

  async release(id: string): Promise<void> {
    if (this.configurations.has(id)) {
      await this.client.call('release', [id]);
    }
  }

  async disconnect(id: string): Promise<void> {
    if (!this.configurations.delete(id)) {
      return;
    }
    await this.client.call('disconnect', [id]);
  }

  async close(): Promise<void> {
    this.configurations.clear();
    await this.client.close();
  }
}
