import type * as Limits from '../src/domain/remote/limits';
import { describe, expect, it, vi } from 'vitest';
import { remoteLimits } from '../src/domain/remote/limits';
import { sftpBounds } from '../src/desktop/remote/sftp/codec';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';
import { sftpFixture } from './support/sftp-fixture';

// A wider codec name cap shows that the client keeps its own resolved-path limit.
vi.mock('../src/domain/remote/limits', async (importOriginal) => {
  const original = await importOriginal<typeof Limits>();
  return {
    remoteLimits: Object.freeze({
      ...original.remoteLimits,
      codecNameBytes: 2 * original.remoteLimits.serverPathBytes,
    }),
  };
});

assertSafeSFTPAfterEach();

const resolved = (kind: 'realpath' | 'readlink', length: number): Buffer =>
  Buffer.from(
    (kind === 'realpath' ? '/' : '') + 'a'.repeat(length - (kind === 'realpath' ? 1 : 0)),
  );

describe('resolved path limit independent of the codec name cap', () => {
  it('runs with a codec name cap above the resolved path limit', () => {
    expect(sftpBounds.nameBytes).toBeGreaterThan(remoteLimits.serverPathBytes);
  });

  it.each(['realpath', 'readlink'] as const)(
    'accepts a %s result of exactly the path limit and refuses one byte more',
    async (kind) => {
      for (const length of [remoteLimits.serverPathBytes, remoteLimits.serverPathBytes + 1]) {
        const { client, server } = sftpFixture();
        await client.connect();
        server.replyOverride = (reply) =>
          reply.kind === 'version'
            ? reply
            : {
                kind: 'name',
                id: reply.id,
                names: [{ filename: resolved(kind, length), longname: Buffer.alloc(0), attrs: {} }],
              };
        const outcome = client[kind](Buffer.from('/home')).then(
          (path) => ({ length: path.length }),
          (error: unknown) => ({ error }),
        );
        if (length === remoteLimits.serverPathBytes) {
          expect(await outcome).toEqual({ length });
          expect(client.connected).toBe(true);
        } else {
          expect(await outcome).toMatchObject({ error: { code: 'VIEWER_REMOTE_PROTOCOL' } });
          expect(client.connected).toBe(false);
        }
      }
    },
  );
});
