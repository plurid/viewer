import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';

export type ArtifactFetcher = typeof fetch;

/** Retains both complete and interrupted downloads; it never truncates an existing artifact. */
export async function downloadRetainedArtifact(
  url: string,
  destination: string,
  limit: number,
  request: ArtifactFetcher,
  timeoutMs = 60_000,
): Promise<string> {
  const response = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body)
    throw new Error(`Electron artifact download failed with HTTP ${response.status}: ${url}`);
  if (response.url && new URL(response.url).protocol !== 'https:')
    throw new Error('Electron artifacts must be downloaded over HTTPS.');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body.cancel();
    throw new Error(`Electron artifact download exceeds ${limit} bytes: ${url}`);
  }
  const reader = response.body.getReader();
  let output: FileHandle | undefined;
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    output = await open(destination, 'wx', 0o600);
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit)
        throw new Error(`Electron artifact download exceeds ${limit} bytes: ${url}`);
      hash.update(chunk.value);
      await output.writeFile(chunk.value);
    }
    if (bytes === 0) throw new Error(`Electron artifact download is empty: ${url}`);
    await output.sync();
    return hash.digest('hex');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await output?.close();
  }
}

export function expectedArchiveHash(checksums: string, archive: string): string {
  const matches = checksums
    .split(/\r?\n/)
    .map((line) => /^([a-fA-F\d]{64})\s+\*?(\S+)$/.exec(line.trim()))
    .filter((match) => match?.[2]?.replace(/^\.\//, '') === archive);
  if (matches.length !== 1)
    throw new Error(`Electron SHASUMS256.txt must identify exactly one ${archive}.`);
  return matches[0]![1]!.toLowerCase();
}
