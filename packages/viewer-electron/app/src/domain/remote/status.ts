import { z } from 'zod';

export const remoteConnectionState = z.enum([
  'saved',
  'connecting',
  'ready',
  'slow',
  'offline',
  'reconnecting',
  'needs-sign-in',
  'host-key-changed',
  'unreachable',
  'disconnected',
]);

export type RemoteConnectionState = z.infer<typeof remoteConnectionState>;
