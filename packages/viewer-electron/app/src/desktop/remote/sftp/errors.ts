export type SFTPErrorCode =
  | 'ENOENT'
  | 'VIEWER_REMOTE_DENIED'
  | 'VIEWER_REMOTE_FAILURE'
  | 'ENOTSUP'
  | 'VIEWER_REMOTE_OFFLINE'
  | 'VIEWER_REMOTE_TIMEOUT'
  | 'VIEWER_REMOTE_DISCONNECTED'
  | 'VIEWER_REMOTE_PROTOCOL'
  | 'ABORT_ERR';

export class SFTPError extends Error {
  constructor(
    public readonly code: SFTPErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SFTPError';
  }
}

export class SFTPProtocolError extends SFTPError {
  constructor(message: string) {
    super('VIEWER_REMOTE_PROTOCOL', message);
    this.name = 'SFTPProtocolError';
  }
}

export function sftpStatusError(status: number, message: Buffer): SFTPError {
  const code: SFTPErrorCode =
    status === 2
      ? 'ENOENT'
      : status === 3
        ? 'VIEWER_REMOTE_DENIED'
        : status === 8
          ? 'ENOTSUP'
          : status === 6 || status === 7
            ? 'VIEWER_REMOTE_OFFLINE'
            : 'VIEWER_REMOTE_FAILURE';
  return new SFTPError(
    code,
    message.toString('utf8') || 'The server rejected the request.',
    status,
  );
}

export const sftpAbortError = (): SFTPError =>
  new SFTPError('ABORT_ERR', 'The server request was cancelled.');
