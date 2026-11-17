import { hasRemoteLocationScheme } from '../../domain/remote/location';
import { localPath } from '../schemas';

export class InvalidLocalPath extends Error {
  readonly code = 'VIEWER_INVALID_LOCAL_PATH';
  constructor() {
    super('Choose an absolute local file or folder path.');
    this.name = 'InvalidLocalPath';
  }
}

export function requireAbsoluteLocalPath(value: string): void {
  assertLocalPath(value);
  if (!localPath.safeParse(value).success) throw new InvalidLocalPath();
}

export function assertLocalPath(value: string): void {
  if (hasRemoteLocationScheme(value))
    throw Object.assign(new Error('This location is on a server.'), {
      code: 'VIEWER_REMOTE_NOT_LOCAL',
    });
}
