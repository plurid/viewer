/**
 * Bounded, read-only SQLite and ZIP/TAR archive agent tools under the content capability and
 * client folder grants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { AgentBroker } from '../src/desktop/agents/agent-broker';
import { agentTools } from '../src/desktop/agents/agent-tools';
import { SettingsService } from '../src/desktop/preferences/settings';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import type { FileServices } from '../src/desktop/files/file-services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import { readSQLite } from '../src/desktop/previews/sqlite';
import { Archives, readArchiveEntryText } from '../src/desktop/previews/archives';
import type { SQLiteRequest } from '../src/domain/previews/data/sqlite';

vi.mock('../src/desktop/files/file-coordination', () => ({
  fileCoordination: {
    run: async (
      _intents: unknown,
      work: (signal?: AbortSignal) => Promise<unknown>,
      signal?: AbortSignal,
    ) => work(signal),
    path: (file: string) => file,
    purpose: () => 'agent reader test',
  },
}));

let root: string;
let granted: string;
let outside: string;

beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-agent-readers-'));
  granted = path.join(root, 'granted');
  outside = path.join(root, 'outside');
  await mkdir(granted);
  await mkdir(outside);
});

afterEach(async () => {
  await trashTemporary(root);
});

async function createBroker(capabilities: ('metadata' | 'content')[]) {
  const dataPath = path.join(root, 'data');
  await mkdir(dataPath, { recursive: true });
  const settings = new SettingsService(
    dataPath,
    root,
    () => true,
    () => {},
  );
  const config = settings.snapshot().settings;
  config.agents.enabled = true;
  config.agents.roots = [granted];
  const archives = new Archives();
  const files = {
    sqlite: (file: string, request: SQLiteRequest, signal?: AbortSignal) =>
      readSQLite(file, request, { signal }),
    archiveList: (file: string) => archives.list(file),
    archiveReadText: (file: string, name: string, maxBytes: number) =>
      readArchiveEntryText(archives, file, name, maxBytes),
  } as unknown as FileServices;
  const requests = new AgentRequests(
    dataPath,
    settings,
    () => {},
    async () => {},
    { read: () => ({ cwd: granted, output: '' }) },
  );
  const broker = new AgentBroker(
    dataPath,
    () => config,
    () => undefined,
    files,
    { all: async () => [], cancel: () => {} } as unknown as ActionPlanner,
    { requests, config: settings, catalog: () => undefined, access: async () => {} },
  );
  const authority = { enabled: true, add: [granted] };
  await broker.access.approve(authority, await broker.access.captureReview(authority));
  const created = (await broker.clientRequest({
    kind: 'create',
    client: {
      name: 'Reader agent',
      roots: [granted],
      capabilities,
      budgets: { maxReadBytes: 1024 * 1024, maxTasks: 4 },
    },
  })) as { token: string };
  const call = async (name: string, args: Record<string, unknown>, token = created.token) => {
    const result = (await broker.handle(
      token,
      { method: 'tools/call', params: { name, arguments: args } },
      new AbortController().signal,
    )) as { content: { text: string }[] };
    return JSON.parse(result.content[0]!.text) as unknown;
  };
  return { broker, call, token: created.token };
}

function makeTar(entries: { name: string; content: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const item of entries) {
    const body = Buffer.from(item.content, 'utf8');
    const header = Buffer.alloc(512, 0);
    header.write(item.name, 0, 'utf8');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let sum = 0;
    for (let index = 0; index < 512; index++) sum += header[index]!;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    blocks.push(header);
    const pad = (512 - (body.length % 512)) % 512;
    blocks.push(body, Buffer.alloc(pad, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

describe('SQLite and archive agent read tools', () => {
  it('advertises read_sqlite, list_archive and read_archive_entry in agentTools', () => {
    const names = agentTools.map((tool) => tool.name);
    expect(names).toContain('read_sqlite');
    expect(names).toContain('list_archive');
    expect(names).toContain('read_archive_entry');
  });

  it('reads SQLite tables, schema and bounded row pages read-only within granted folders', async () => {
    const dbPath = path.join(granted, 'app.sqlite');
    const outsideDb = path.join(outside, 'secret.sqlite');
    for (const target of [dbPath, outsideDb]) {
      const db = new DatabaseSync(target);
      db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      db.exec('CREATE VIEW item_view AS SELECT id, name FROM items');
      db.exec("INSERT INTO items (name) VALUES ('Alpha'), ('Beta'), ('Gamma')");
      db.close();
    }

    const { call } = await createBroker(['metadata', 'content']);
    const tables = (await call('read_sqlite', { path: dbPath })) as {
      kind: string;
      version: { size: number; modified: number };
      objects: { name: string; kind: string; definition: string }[];
    };
    expect(tables.kind).toBe('tables');
    expect(tables.version).toEqual(
      expect.objectContaining({ size: expect.any(Number), modified: expect.any(Number) }),
    );
    expect(tables.objects.map((object) => object.name)).toEqual(['item_view', 'items']);
    expect(tables.objects.find((object) => object.name === 'items')?.definition).toContain(
      'CREATE TABLE items',
    );

    const page = (await call('read_sqlite', {
      path: dbPath,
      kind: 'rows',
      table: 'items',
      offset: 1,
      limit: 1,
    })) as {
      kind: string;
      version: { size: number; modified: number };
      rows: { kind: string; text?: string }[][];
      more: boolean;
    };
    expect(page.kind).toBe('rows');
    expect(page.version).toEqual(tables.version);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]![1]).toMatchObject({ kind: 'text', text: 'Beta' });
    expect(page.more).toBe(true);

    // Views are never executed by the read-only SQLite authorizer.
    await expect(
      call('read_sqlite', { path: dbPath, kind: 'rows', table: 'item_view' }),
    ).rejects.toThrow(/does not run views/i);
    // Files outside granted folders are refused.
    await expect(call('read_sqlite', { path: outsideDb })).rejects.toThrow(/authorized folders/i);

    // Clients without content capability are refused.
    const metadataOnly = await createBroker(['metadata']);
    await expect(metadataOnly.call('read_sqlite', { path: dbPath })).rejects.toThrow();
  });

  it('lists ZIP and TAR archives and reads bounded UTF-8 entry text while refusing unsafe paths and binaries', async () => {
    const zipPath = path.join(granted, 'bundle.zip');
    const tarPath = path.join(granted, 'bundle.tar');
    const outsideZip = path.join(outside, 'secret.zip');
    const pemKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const opensshKey =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n';
    const zipBytes = zipSync({
      'notes/readme.txt': strToU8('Hello from archive! '.repeat(20)),
      'notes/utf8.txt': strToU8('a😀b'),
      'notes/accent.txt': strToU8('héllo'),
      'bin/blob.bin': new Uint8Array([0, 1, 2, 3, 4]),
      'bin/control.bin': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      'bin/bad-utf8.bin': new Uint8Array([0x80, 0x81, 0xfe, 0xff]),
      'keys/server.key': strToU8(pemKey),
      'keys/id_ed25519': strToU8(opensshKey),
    });
    await writeFile(zipPath, zipBytes);
    await writeFile(outsideZip, zipBytes);
    await writeFile(tarPath, makeTar([{ name: 'doc.txt', content: 'TAR text entry' }]));

    const { call } = await createBroker(['metadata', 'content']);
    const listedZip = (await call('list_archive', { path: zipPath, limit: 1 })) as {
      entries: { name: string }[];
      totalEntries: number;
      nextOffset?: number;
    };
    expect(listedZip.totalEntries).toBe(8);
    expect(listedZip.entries).toHaveLength(1);
    expect(listedZip.nextOffset).toBe(1);

    const listedTar = (await call('list_archive', { path: tarPath })) as {
      entries: { name: string }[];
    };
    expect(listedTar.entries.map((entry) => entry.name)).toEqual(['doc.txt']);

    const readText = (await call('read_archive_entry', {
      path: zipPath,
      entry: 'notes/readme.txt',
      maxBytes: 24,
    })) as { text: string; truncated: boolean; size: number };
    expect(readText.text).toBe('Hello from archive! Hell');
    expect(readText.truncated).toBe(true);
    expect(readText.size).toBe(400);

    // Mid-character UTF-8 truncation trims cleanly without U+FFFD replacement corruption.
    const emojiCut = (await call('read_archive_entry', {
      path: zipPath,
      entry: 'notes/utf8.txt',
      maxBytes: 3,
    })) as { text: string; truncated: boolean };
    expect(emojiCut.text).toBe('a');
    expect(emojiCut.truncated).toBe(true);
    expect(emojiCut.text).not.toContain('\ufffd');

    const accentCut = (await call('read_archive_entry', {
      path: zipPath,
      entry: 'notes/accent.txt',
      maxBytes: 2,
    })) as { text: string; truncated: boolean };
    expect(accentCut.text).toBe('h');
    expect(accentCut.truncated).toBe(true);
    expect(accentCut.text).not.toContain('\ufffd');

    const readTarText = (await call('read_archive_entry', {
      path: tarPath,
      entry: 'doc.txt',
    })) as { text: string; truncated: boolean };
    expect(readTarText.text).toBe('TAR text entry');
    expect(readTarText.truncated).toBe(false);

    // Unsafe traversal paths, binaries, invalid UTF-8, and private keys are refused.
    await expect(
      call('read_archive_entry', { path: zipPath, entry: '../escape.txt' }),
    ).rejects.toThrow();
    await expect(
      call('read_archive_entry', { path: zipPath, entry: 'bin/blob.bin' }),
    ).rejects.toThrow(/binary/i);
    await expect(
      call('read_archive_entry', { path: zipPath, entry: 'bin/control.bin' }),
    ).rejects.toThrow(/binary/i);
    await expect(
      call('read_archive_entry', { path: zipPath, entry: 'bin/bad-utf8.bin' }),
    ).rejects.toThrow(/UTF-8/i);
    await expect(
      call('read_archive_entry', { path: zipPath, entry: 'keys/server.key' }),
    ).rejects.toThrow(/private key/i);
    await expect(
      call('read_archive_entry', { path: zipPath, entry: 'keys/id_ed25519' }),
    ).rejects.toThrow(/private key/i);
    await expect(call('list_archive', { path: outsideZip })).rejects.toThrow(/authorized folders/i);

    const metadataOnly = await createBroker(['metadata']);
    await expect(metadataOnly.call('list_archive', { path: zipPath })).rejects.toThrow();
    await expect(
      metadataOnly.call('read_archive_entry', { path: zipPath, entry: 'notes/readme.txt' }),
    ).rejects.toThrow();
  });
});
