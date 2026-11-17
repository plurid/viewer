import type { TransformCallback } from 'node:stream';
import { Duplex } from 'node:stream';

export interface SFTPDuplexOptions {
  highWaterMark?: number;
  writeDelayMs?: number;
}

class Endpoint extends Duplex {
  peer!: Endpoint;
  private releaseWrite: TransformCallback | undefined;

  constructor(private readonly options: SFTPDuplexOptions) {
    super({ highWaterMark: options.highWaterMark ?? 256 * 1024 });
    this.on('error', () => {});
  }

  override _read(): void {
    const release = this.releaseWrite;
    this.releaseWrite = undefined;
    release?.();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const deliver = (): void => {
      if (this.peer.destroyed) {
        callback(new Error('The in-process peer closed.'));
        return;
      }
      if (this.peer.push(Buffer.from(chunk))) callback();
      else this.peer.releaseWrite = callback;
    };
    if (this.options.writeDelayMs) setTimeout(deliver, this.options.writeDelayMs);
    else queueMicrotask(deliver);
  }

  override _final(callback: TransformCallback): void {
    this.peer.push(null);
    callback();
  }

  override _destroy(error: Error | null, callback: TransformCallback): void {
    const release = this.releaseWrite;
    this.releaseWrite = undefined;
    release?.();
    if (!this.peer.destroyed) this.peer.destroy();
    callback(error);
  }
}

export function sftpDuplexPair(options: SFTPDuplexOptions = {}): {
  client: Duplex;
  server: Duplex;
} {
  const client = new Endpoint(options);
  const server = new Endpoint(options);
  client.peer = server;
  server.peer = client;
  return { client, server };
}
