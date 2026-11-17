import { z } from 'zod';
import { remoteLimits } from './limits';

export const remoteScheme = 'viewer-sftp://';
export const connectionID = z
  .string()
  .min(remoteLimits.connectionIDMinCharacters)
  .max(remoteLimits.connectionIDMaxCharacters)
  .regex(/^[a-z0-9]+$(?![\s\S])/);

/** TextEncoder replaces lone surrogates, which would alias distinct server paths and hashes. */
export function validRemoteUnicode(text: string): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

export const remoteUTF8Bytes = (text: string): number => new TextEncoder().encode(text).length;

export const remotePath = z
  .string()
  .regex(/^\/(?:[^/\0]+(?:\/[^/\0]+)*)?$/)
  .refine(
    (file) => file.split('/').every((part) => part !== '.' && part !== '..'),
    'Use a normalized server path.',
  )
  .refine(validRemoteUnicode, 'Use valid UTF-8 text.')
  .refine((file) => remoteUTF8Bytes(file) <= remoteLimits.serverPathBytes);

export const remoteName = z
  .string()
  .min(1)
  .refine((name) => name !== '.' && name !== '..' && !/[/\0]/.test(name))
  .refine(validRemoteUnicode, 'Use valid UTF-8 text.')
  .refine((name) => remoteUTF8Bytes(name) <= remoteLimits.serverNameBytes);

function locationParts(location: string): ParsedRemoteLocation | undefined {
  if (!location.startsWith(remoteScheme)) return;
  const boundary = location.indexOf('/', remoteScheme.length);
  if (boundary === -1) return;
  const id = location.slice(remoteScheme.length, boundary);
  const path = location.slice(boundary);
  if (connectionID.safeParse(id).success && remotePath.safeParse(path).success)
    return { connectionID: id, path };
}

/** Internal locations are raw strings. URL decoding would change literal server filenames. */
export const remoteLocation = z
  .string()
  .refine((location) => locationParts(location) !== undefined, {
    message: 'Use a valid Viewer server location.',
  });
export type RemoteLocation = z.infer<typeof remoteLocation>;

export interface ParsedRemoteLocation {
  connectionID: string;
  path: string;
}

export interface RemoteDisplayConnection {
  host: string;
  user?: string;
}

/** Reserve malformed and differently cased forms too, so local filesystem guards fail closed. */
export const hasRemoteLocationScheme = (location: string): boolean =>
  /^viewer-sftp:/i.test(location);
export const isRemoteLocation = (location: unknown): location is RemoteLocation =>
  remoteLocation.safeParse(location).success;

export function parseRemoteLocation(location: string): ParsedRemoteLocation {
  return locationParts(remoteLocation.parse(location))!;
}

export function remoteJoin(folder: string, name: string): RemoteLocation {
  const parent = parseRemoteLocation(folder);
  const child = remoteName.parse(name);
  return remoteLocation.parse(folder + (parent.path === '/' ? '' : '/') + child);
}

export function remoteParent(location: string): RemoteLocation {
  const current = parseRemoteLocation(location);
  const end = current.path.lastIndexOf('/');
  return remoteScheme + current.connectionID + (end <= 0 ? '/' : current.path.slice(0, end));
}

export function remoteBaseName(location: string): string {
  const current = parseRemoteLocation(location).path;
  return current === '/' ? '/' : current.slice(current.lastIndexOf('/') + 1);
}

/** Root through the current folder, with backslashes retained as part of each name. */
export function remoteAncestry(location: string): RemoteLocation[] {
  parseRemoteLocation(location);
  const ancestry = [location];
  while (remoteParent(ancestry[0]!) !== ancestry[0]) ancestry.unshift(remoteParent(ancestry[0]!));
  return ancestry;
}

export function remoteContains(root: string, file: string): boolean {
  const base = locationParts(root);
  const target = locationParts(file);
  if (!base || !target || base.connectionID !== target.connectionID) return false;
  return base.path === target.path || base.path === '/' || target.path.startsWith(base.path + '/');
}

export function displayLocation(location: string, connection: RemoteDisplayConnection): string {
  if (!hasRemoteLocationScheme(location)) return location;
  const { path } = parseRemoteLocation(location);
  return (connection.user ? connection.user + '@' : '') + connection.host + ':' + path;
}
