import { z } from 'zod';
import { portablePath } from '../schemas';
import { connectionID, remotePath, validRemoteUnicode } from './location';
import { remoteLimits } from './limits';

const sshWord = /^(?!-)[A-Za-z0-9._-]+$(?![\s\S])/;

export const remoteUser = z.string().regex(sshWord);

function isRemoteHost(host: string): boolean {
  if (sshWord.test(host)) return true;
  if (!/^\[[0-9a-f:.]+\]$(?![\s\S])/i.test(host)) return false;
  try {
    return new URL('http://' + host + '/').hostname.startsWith('[');
  } catch {
    return false;
  }
}

export const remoteHost = z
  .string()
  .refine(isRemoteHost, 'Use a host name or bracketed IPv6 address.');
export const remotePort = z.number().int().min(1).max(65535);

export interface RemoteEndpoint {
  host: string;
  user?: string;
  port?: number;
}

/** A destination is data for fixed SSH arguments, never a free-form option string. */
export function parseRemoteEndpoint(input: string): RemoteEndpoint {
  const parts = /^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$(?![\s\S])/.exec(input);
  if (!parts) throw new Error('Use [user@]host[:port] for the server.');
  const endpoint: RemoteEndpoint = { host: remoteHost.parse(parts[2]) };
  if (parts[1] !== undefined) endpoint.user = remoteUser.parse(parts[1]);
  if (parts[3] !== undefined) endpoint.port = remotePort.parse(Number(parts[3]));
  return endpoint;
}

export const remoteJumpHost = z.string().refine((value) => {
  try {
    parseRemoteEndpoint(value);
    return true;
  } catch {
    return false;
  }
}, 'Use [user@]host[:port] for each jump host.');

export const remoteConnectionName = z
  .string()
  .min(1)
  .max(remoteLimits.connectionNameCharacters)
  .refine((name) => name.trim() === name && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name))
  .refine(validRemoteUnicode);

export const sshConfigConsent = z.enum(['not-asked', 'allowed', 'declined']);
export type SSHConfigConsent = z.infer<typeof sshConfigConsent>;

/** Saved records carry no credentials, process options or filesystem authority. */
export const remoteConnection = z
  .object({
    id: connectionID,
    name: remoteConnectionName,
    host: remoteHost,
    user: remoteUser.optional(),
    port: remotePort.optional(),
    jump: z.array(remoteJumpHost).max(remoteLimits.jumpHosts).optional(),
    identityFile: portablePath.optional(),
    startPath: remotePath.optional(),
    autoConnect: z.boolean().default(false),
    sshConfig: sshConfigConsent.default('not-asked'),
  })
  .strict();

export type RemoteConnection = z.infer<typeof remoteConnection>;
