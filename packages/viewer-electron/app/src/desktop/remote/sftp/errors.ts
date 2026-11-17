import { remoteLimits } from '../../../domain/remote/limits';

export type SFTPErrorCode =
  | 'ENOENT'
  | 'VIEWER_REMOTE_DENIED'
  | 'VIEWER_REMOTE_FAILURE'
  | 'ENOTSUP'
  | 'VIEWER_REMOTE_OFFLINE'
  | 'VIEWER_REMOTE_TIMEOUT'
  | 'VIEWER_REMOTE_DISCONNECTED'
  | 'VIEWER_REMOTE_PROTOCOL'
  | 'VIEWER_REMOTE_SHORT_SOURCE'
  | 'ABORT_ERR';

export class SFTPError extends Error {
  constructor(
    public readonly code: SFTPErrorCode,
    message: string,
    public readonly status?: number,
    public readonly rawMessage?: Buffer,
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
  // Format characters, line and paragraph separators and invisible code points can reorder,
  // break or hide display text; the raw bytes stay available separately.
  const display = [
    ...message
      .toString('utf8')
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu, ''),
  ]
    .slice(0, remoteLimits.serverPromptCharacters)
    .join('');
  return new SFTPError(
    code,
    display || 'The server rejected the request.',
    status,
    Buffer.from(message),
  );
}

export const sftpAbortError = (): SFTPError =>
  new SFTPError('ABORT_ERR', 'The server request was canceled.');
