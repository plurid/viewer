import type * as FileSystemModule from 'node:fs/promises';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, realpath, symlink, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { WebPreviews } from '../src/desktop/previews/web/service';
import { webLimits } from '../src/desktop/previews/web/policy';

const replaced = vi.hoisted(() => new Set<string>());
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof FileSystemModule>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args);
      return replaced.has(String(args[0]))
        ? new Proxy(info, {
            get(target, key) {
              return key === 'ino' ? Number(target.ino) + 1 : Reflect.get(target, key, target);
            },
          })
        : info;
    },
  };
});

const services: WebPreviews[] = [];
afterEach(async () => {
  replaced.clear();
  await Promise.allSettled(services.splice(0).map((service) => service.close()));
});

async function fixture(access = vi.fn(async (_files: readonly string[]) => {})) {
  const temporary = await realpath(await temporaryRoot('viewer-web-previews-'));
  const root = path.join(temporary, 'Project');
  await mkdir(root);
  await writeFile(
    path.join(root, 'page.html'),
    '<!doctype html><script src="/app.js"></script><link rel="stylesheet" href="style.css"><h1>Generated page</h1>',
  );
  await writeFile(path.join(root, 'style.css'), 'body { color: green; }');
  await writeFile(path.join(root, 'app.js'), 'window.generated = true;');
  await writeFile(path.join(root, 'data.json'), '{"generated":true}');
  await writeFile(path.join(root, '.env'), 'GENERATED_PRIVATE_SENTINEL');
  await writeFile(path.join(temporary, 'outside.css'), 'GENERATED_OUTSIDE_SENTINEL');
  const changed = vi.fn();
  const service = new WebPreviews(access, changed);
  services.push(service);
  return { temporary, root, service, access, changed, html: path.join(root, 'page.html') };
}

function readHttp(
  port: number,
  pathname: string,
  headers: Record<string, string> = {},
  method = 'GET',
) {
  return new Promise<{
    status: number;
    text: string;
    headers: IncomingHttpHeaders;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: { Host: `127.0.0.1:${port}`, ...headers },
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () =>
          resolve({
            status: response.statusCode!,
            text: Buffer.concat(chunks).toString(),
            headers: response.headers,
          }),
        );
        response.once('error', reject);
      },
    );
    request.once('error', reject);
    request.end();
  });
}

async function sparse(file: string, size: number) {
  const handle = await open(file, 'wx');
  try {
    await handle.truncate(size);
  } finally {
    await handle.close();
  }
}

describe('private offline HTML capabilities', () => {
  it('serves bounded HTML and companions with an opaque-script sandbox and no Viewer/network sources', async () => {
    const f = await fixture();
    const preview = await f.service.openHtml(1, f.html, 'resource');
    expect(f.service.ownsHtmlURL(1, preview.url)).toBe(true);
    expect(f.service.ownsHtmlURL(2, preview.url)).toBe(false);
    expect(f.service.ownsHtmlURL(1, preview.url.replace('viewer-html:', 'https:'))).toBe(false);
    const response = await f.service.response(new Request(preview.url));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Generated page');
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain('viewer-resource:');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
    for (const [name, content] of [
      ['style.css', 'color: green'],
      ['app.js', 'generated = true'],
      ['data.json', 'generated'],
    ]) {
      const asset = await f.service.response(
        new Request(new URL(name, preview.url), { headers: { Origin: 'null' } }),
      );
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain(content);
    }
    expect(f.access).toHaveBeenCalledWith(expect.arrayContaining([path.join(f.root, 'style.css')]));
    const foreign = await f.service.response(
      new Request(preview.url, { headers: { Origin: 'https://foreign.invalid' } }),
    );
    expect(foreign.status).toBe(403);
  });

  it('gives independently closed surfaces separate capabilities for the same resource', async () => {
    const f = await fixture();
    const first = await f.service.openHtml(1, f.html, 'shared-resource');
    const second = await f.service.openHtml(1, f.html, 'shared-resource');
    expect(first.id).not.toBe(second.id);
    await f.service.closeHtml(1, first.id);
    expect((await f.service.response(new Request(first.url))).status).toBe(404);
    const surviving = await f.service.response(new Request(second.url));
    expect(await surviving.text()).toContain('Generated page');
    await f.service.releaseResource('shared-resource');
    expect((await f.service.response(new Request(second.url))).status).toBe(404);
  });

  it('supports XHTML and literal percent names with one decoding pass', async () => {
    const f = await fixture();
    const xhtml = path.join(f.root, '100%.xhtml');
    await writeFile(
      xhtml,
      '<html xmlns="http://www.w3.org/1999/xhtml"><body>Generated XHTML</body></html>',
    );
    await writeFile(path.join(f.root, 'a%20b.css'), '/* literal-percent-name */');
    await writeFile(path.join(f.root, 'a b.css'), '/* space-name */');
    const preview = await f.service.openHtml(1, xhtml, 'xhtml');
    const page = await f.service.response(new Request(preview.url));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('application/xhtml+xml');
    expect(await page.text()).toContain('Generated XHTML');
    const percent = await f.service.response(new Request(new URL('a%2520b.css', preview.url)));
    const space = await f.service.response(new Request(new URL('a%20b.css', preview.url)));
    expect(await percent.text()).toContain('literal-percent-name');
    expect(await space.text()).toContain('space-name');
    const address = new URL(preview.url);
    const escaped = await f.service.response(
      new Request(`${address.protocol}//${address.host}/%252e%252e/outside.css`),
    );
    expect(escaped.status).toBe(404);
    expect(await escaped.text()).not.toContain('OUTSIDE_SENTINEL');
  });

  it('enforces main HTML size and file-descriptor identity before returning content', async () => {
    const f = await fixture();
    const large = path.join(f.root, 'large.html');
    await sparse(large, webLimits.htmlBytes + 1);
    await expect(f.service.openHtml(1, large, 'large')).rejects.toThrow('too large');
    const preview = await f.service.openHtml(1, f.html, 'resource');
    replaced.add(f.html);
    const response = await f.service.response(new Request(preview.url));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Generated page');
  });

  it('rejects encoded traversal, hidden files, outside links and special files without reading them', async () => {
    const f = await fixture();
    await symlink(path.join(f.temporary, 'outside.css'), path.join(f.root, 'outside.css'));
    await symlink(path.join(f.root, '.env'), path.join(f.root, 'hidden.css'));
    execFileSync('/usr/bin/mkfifo', [path.join(f.root, 'pipe.css')]);
    const preview = await f.service.openHtml(1, f.html, 'resource');
    const address = new URL(preview.url);
    const base = `${address.protocol}//${address.host}`;
    for (const pathname of [
      '/.env',
      '/outside.css',
      '/hidden.css',
      '/pipe.css',
      '/%2foutside.css',
      '/%5coutside.css',
      '/%00.css',
    ]) {
      const response = await f.service.response(new Request(base + pathname));
      expect([400, 403]).toContain(response.status);
      expect(await response.text()).not.toContain('SENTINEL');
    }
    expect(await readFile(path.join(f.root, '.env'), 'utf8')).toBe('GENERATED_PRIVATE_SENTINEL');
  });

  it('cancels pending preview admission when its resource is released', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const access = vi.fn(async () => {
      entered();
      await gate;
    });
    const f = await fixture(access);
    const opening = f.service.openHtml(1, f.html, 'pending');
    const rejected = expect(opening).rejects.toThrow();
    await started;
    await f.service.releaseResource('pending');
    release();
    await rejected;
  });

  it('bounds concurrent streams and drains them when a preview closes', async () => {
    const f = await fixture();
    await sparse(path.join(f.root, 'stream.css'), 8 * 1024 * 1024);
    const preview = await f.service.openHtml(1, f.html, 'resource');
    const url = new URL('stream.css', preview.url);
    const streams: Response[] = [];
    for (let i = 0; i < webLimits.sessionReads; i++)
      streams.push(await f.service.response(new Request(url)));
    expect(streams.every((response) => response.status === 200)).toBe(true);
    expect((await f.service.response(new Request(url))).status).toBe(429);
    await f.service.closeHtml(1, preview.id);
    await Promise.allSettled(streams.map((response) => response.body?.cancel()));
    expect(f.service.ownsHtmlURL(1, preview.url)).toBe(false);
  });
});

describe('explicit folder loopback servers', () => {
  it('starts only explicitly, deduplicates one pane, and keeps independent same-root panes', async () => {
    const f = await fixture();
    expect(f.service.list(1)).toEqual([]);
    const [first, repeated] = await Promise.all([
      f.service.start(1, f.root, 'pane-a'),
      f.service.start(1, f.root, 'pane-a'),
    ]);
    expect(first).toEqual(repeated);
    const other = await f.service.start(1, f.root, 'pane-b');
    expect(other.id).not.toBe(first.id);
    expect(other.port).not.toBe(first.port);
    expect(first.url).toBe(`http://127.0.0.1:${first.port}/`);
    expect(f.service.list(2)).toEqual([]);
    expect(() => f.service.get(2, first.id)).toThrow('unavailable');
    await f.service.dispose(2, first.id);
    expect(f.service.get(1, first.id).state).toBe('running');
  });

  it('serves root index and absolute assets, supports HEAD and bounded single ranges', async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.root, 'index.html'),
      '<script src="/app.js"></script>Generated index',
    );
    const server = await f.service.start(1, f.root, 'pane');
    const index = await readHttp(server.port, '/');
    expect(index.status).toBe(200);
    expect(index.text).toContain('Generated index');
    expect(index.headers['content-security-policy']).toBeUndefined();
    expect(index.headers['access-control-allow-origin']).toBeUndefined();
    const head = await readHttp(server.port, '/style.css', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.text).toBe('');
    expect(head.headers['content-type']).toContain('text/css');
    expect(head.headers['x-content-type-options']).toBe('nosniff');
    const range = await readHttp(server.port, '/style.css', { Range: 'bytes=0-3' });
    expect(range.status).toBe(206);
    expect(range.text).toBe('body');
    expect(range.headers['content-range']).toBe('bytes 0-3/22');
    expect((await readHttp(server.port, '/style.css', { Range: 'bytes=-2' })).text).toBe(' }');
    expect((await readHttp(server.port, '/style.css', { Range: 'bytes=999-1000' })).status).toBe(
      416,
    );
    expect((await readHttp(server.port, '/style.css', { Range: 'bytes=0-2,4-5' })).status).toBe(
      416,
    );
    expect((await readHttp(server.port, '/', {}, 'POST')).status).toBe(405);
  });

  it('escapes and bounds directory listings while excluding hidden and outside-link entries', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, '<script>&.txt'), 'Generated escaped fixture');
    await symlink(path.join(f.temporary, 'outside.css'), path.join(f.root, 'Outside link'));
    const server = await f.service.start(1, f.root, 'pane');
    const listing = await readHttp(server.port, '/');
    expect(listing.text).toContain('&lt;script&gt;&amp;.txt');
    expect(listing.text).not.toContain('<script>');
    expect(listing.text).not.toContain('.env');
    expect(listing.text).not.toContain('Outside link');
    await Promise.all(
      Array.from({ length: webLimits.directoryEntries + 1 }, (_, index) =>
        writeFile(path.join(f.root, `Generated-${index}.txt`), ''),
      ),
    );
    const bounded = await readHttp(server.port, '/');
    expect((bounded.text.match(/<li>/g) ?? []).length).toBe(webLimits.directoryEntries);
    expect(bounded.text).toContain('limited');
  });

  it('refuses traversal, alternate Host, foreign Origin, cross-site browser and request-body traffic', async () => {
    const f = await fixture();
    await symlink(path.join(f.temporary, 'outside.css'), path.join(f.root, 'outside.css'));
    const server = await f.service.start(1, f.root, 'pane');
    for (const pathname of [
      '/../outside.css',
      '/%2e%2e/outside.css',
      '/%2foutside.css',
      '/%5coutside.css',
      '/.env',
      '/outside.css',
    ])
      expect([400, 403]).toContain((await readHttp(server.port, pathname)).status);
    const rejectedHeaders: Record<string, string>[] = [
      { Host: `localhost:${server.port}` },
      { Host: `foreign.invalid:${server.port}` },
      { Origin: 'null' },
      { Origin: 'https://foreign.invalid' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
      { Referer: 'https://foreign.invalid/' },
      { 'Content-Length': '1' },
    ];
    for (const headers of rejectedHeaders)
      expect([400, 403]).toContain((await readHttp(server.port, '/style.css', headers)).status);
    expect(
      (
        await readHttp(server.port, '/style.css', {
          Origin: server.url.slice(0, -1),
          'Sec-Fetch-Site': 'same-origin',
        })
      ).status,
    ).toBe(200);
  });

  it('keeps a bounded memory log without queries, headers, bodies or per-request notifications', async () => {
    const f = await fixture();
    const server = await f.service.start(1, f.root, 'pane');
    for (let index = 0; index <= webLimits.logs; index++)
      await readHttp(server.port, `/data.json?secret=${index}`, {
        Authorization: 'Generated secret header',
      });
    const detail = f.service.inspect(1, server.id);
    expect(detail.logs).toHaveLength(webLimits.logs);
    expect(detail.logs[0]!.sequence).toBe(2);
    expect(detail.logs.every((entry) => entry.path === '/data.json' && entry.status === 200)).toBe(
      true,
    );
    expect(JSON.stringify(detail.logs)).not.toContain('secret');
    expect(f.changed).toHaveBeenCalledOnce();
    f.service.clearLog(1, server.id);
    expect(f.service.inspect(1, server.id).logs).toEqual([]);
    await readHttp(server.port, '/data.json');
    expect(f.service.inspect(1, server.id).logs[0]!.sequence).toBe(webLimits.logs + 2);
  });

  it('pins requested and actual folder identities, rejects replacements and never restarts them implicitly', async () => {
    const f = await fixture();
    const info = await lstat(f.root);
    const id = `${info.dev}:${info.ino}`;
    await expect(f.service.start(1, f.root, 'wrong-source', '1:2')).rejects.toThrow('changed');
    const server = await f.service.start(1, f.root, 'pane', id);
    replaced.add(f.root);
    expect((await readHttp(server.port, '/data.json')).status).toBe(403);
    await expect(f.service.restart(1, server.id)).rejects.toThrow('changed');
    expect(f.service.get(1, server.id).state).toBe('stopped');
  });

  it('pins an explicitly selected root alias while rejecting links escaping its actual folder', async () => {
    const f = await fixture();
    const alias = path.join(f.temporary, 'Project alias');
    await symlink(f.root, alias, 'dir');
    const info = await lstat(alias);
    const server = await f.service.start(1, alias, 'alias-pane', `${info.dev}:${info.ino}`);
    expect(server.root).toBe(f.root);
    expect((await readHttp(server.port, '/data.json')).status).toBe(200);
    replaced.add(alias);
    expect((await readHttp(server.port, '/data.json')).status).toBe(403);
    await expect(f.service.restart(1, server.id)).rejects.toThrow('changed');
  });

  it('bounds stopped records and disposes them independently from live peers', async () => {
    const f = await fixture();
    const records = [];
    for (let index = 0; index < webLimits.ownerRecords; index++) {
      const record = await f.service.start(1, f.root, `stopped-${index}`);
      await f.service.stop(1, record.id);
      records.push(record);
    }
    await expect(f.service.start(1, f.root, 'overflow')).rejects.toThrow('Close a server plane');
    expect(f.service.list(1)).toHaveLength(webLimits.ownerRecords);
    await f.service.dispose(1, records[0]!.id);
    const admitted = await f.service.start(1, f.root, 'new-slot');
    expect(admitted.state).toBe('running');
    expect(f.service.list(1)).toHaveLength(webLimits.ownerRecords);
  });

  it('rechecks native access while streaming and drains active HTTP responses on Stop', async () => {
    let allowed = true;
    const access = vi.fn(async () => {
      if (!allowed) throw new Error('Access revoked');
    });
    const f = await fixture(access);
    await sparse(path.join(f.root, 'stream.css'), 8 * 1024 * 1024);
    const preview = await f.service.openHtml(1, f.html, 'stream');
    const response = await f.service.response(new Request(new URL('stream.css', preview.url)));
    const body = response.body!.getReader();
    expect((await body.read()).done).toBe(false);
    allowed = false;
    await expect(
      (async () => {
        while (!(await body.read()).done) {
          /* Drain bounded queued chunks until access is rechecked. */
        }
      })(),
    ).rejects.toThrow('access');
    allowed = true;
    const server = await f.service.start(1, f.root, 'active-stream');
    const client = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: server.port, path: '/stream.css', agent: false },
        (incoming) => {
          incoming.on('error', () => {});
          incoming.pause();
          resolve(incoming);
        },
      );
      request.once('error', reject);
      request.end();
    });
    await f.service.stop(1, server.id);
    client.resume();
    await vi.waitFor(() => expect(client.destroyed).toBe(true));
    expect(f.service.get(1, server.id).state).toBe('stopped');
  });

  it('stops/restarts one plane and drains listeners on owner close, revocation and quit', async () => {
    const f = await fixture();
    const first = await f.service.start(1, f.root, 'a');
    const other = await f.service.start(2, f.root, 'b');
    await f.service.stop(1, first.id);
    expect(f.service.inspect(1, first.id).server.state).toBe('stopped');
    const restarted = await f.service.restart(1, first.id);
    expect(restarted.id).toBe(first.id);
    expect((await readHttp(restarted.port, '/data.json')).status).toBe(200);
    await f.service.stopOwner(1);
    expect(f.service.list(1)).toEqual([]);
    expect((await readHttp(other.port, '/data.json')).status).toBe(200);
    await f.service.quiesce(f.root);
    expect(f.service.get(2, other.id).state).toBe('stopped');
    await f.service.dispose(2, other.id);
    await f.service.dispose(2, other.id);
    expect(f.service.list(2)).toEqual([]);
    await f.service.close();
    await expect(f.service.start(3, f.root, 'late')).rejects.toThrow('closed');
  });

  it('aborts admission that is waiting for access when the owner closes', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(
      vi.fn(async () => {
        entered();
        await gate;
      }),
    );
    const opening = f.service.start(1, f.root, 'pending');
    const rejected = expect(opening).rejects.toThrow();
    await started;
    await f.service.stopOwner(1);
    release();
    await rejected;
    expect(f.service.list(1)).toEqual([]);
  });
});
