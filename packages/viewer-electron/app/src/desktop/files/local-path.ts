import { hasRemoteLocationScheme } from '../../domain/remote/location';

export function assertLocalPath(value: string): void {
  if (hasRemoteLocationScheme(value))
    throw Object.assign(new Error('This location is on a server.'), {
      code: 'VIEWER_REMOTE_NOT_LOCAL',
    });
}
