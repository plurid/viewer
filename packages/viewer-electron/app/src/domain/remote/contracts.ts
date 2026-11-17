import { z } from 'zod';
import { remoteConnection } from './connections';
import type { RemoteConnection } from './connections';
import type { RemoteAddress } from './address';
import type { RemoteConnectionState } from './status';
import type { SSHHostKey } from './ssh-errors';
import { connectionID } from './location';
import { remoteLimits } from './limits';

export const remoteRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list') }).strict(),
  z.object({ type: z.literal('save'), connection: remoteConnection }).strict(),
  z.object({ type: z.literal('remove'), id: connectionID }).strict(),
  z.object({ type: z.literal('connect'), id: connectionID }).strict(),
  z.object({ type: z.literal('disconnect'), id: connectionID }).strict(),
  z
    .object({
      type: z.literal('resolve-address'),
      address: z.string().max(remoteLimits.addressCharacters),
    })
    .strict(),
  z
    .object({
      type: z.literal('ssh-config-hosts'),
      id: connectionID,
      consent: z.boolean(),
    })
    .strict(),
]);

export type RemoteRequest = z.infer<typeof remoteRequest>;

export interface RemoteConnectionSnapshot {
  connection: RemoteConnection;
  state: RemoteConnectionState;
  /** Automatic reconnect attempts since the last successful sign-in. */
  attempt: number;
  /** When the current state began, for "Offline since 10:42". */
  since: number;
  /** The SFTP starting folder, once ready. */
  home?: string;
  /** The key the server offered when its identity changed. */
  hostKey?: SSHHostKey;
}

export interface RemoteReply {
  connections: RemoteConnectionSnapshot[];
  address?: RemoteAddress;
  hosts?: string[];
}
