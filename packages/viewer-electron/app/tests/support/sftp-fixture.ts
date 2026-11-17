import type { SFTPClientOptions } from '../../src/desktop/remote/sftp/client';
import type { FakeSFTPOptions } from './fake-sftp-server';
import type { SFTPDuplexOptions } from './sftp-duplex';
import { SFTPClient } from '../../src/desktop/remote/sftp/client';
import { FakeSFTPServer } from './fake-sftp-server';
import { sftpDuplexPair } from './sftp-duplex';

export function sftpFixture(
  serverOptions: FakeSFTPOptions = {},
  clientOptions: SFTPClientOptions = {},
  duplexOptions: SFTPDuplexOptions = {},
): { client: SFTPClient; server: FakeSFTPServer } {
  const transport = sftpDuplexPair(duplexOptions);
  return {
    client: new SFTPClient(transport.client, clientOptions),
    server: new FakeSFTPServer(transport.server, serverOptions),
  };
}

export const sftpTurn = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};
