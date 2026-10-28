import type * as FileSystemModule from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AgentAccess,
  type AgentAccessChange,
  type AgentAccessReview,
  type RequestedAgentAccess,
} from '../src/desktop/agents/agent-access';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { DocumentStore } from '../src/desktop/persistence/document-store';

const canonicalOverrides = vi.hoisted(() => new Map<string, string>());
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof FileSystemModule>();
  return {
    ...actual,
    realpath: async (file: string) => canonicalOverrides.get(file) ?? actual.realpath(file),
  };
});

let root: string;
let a: string;
let b: string;
let requested: RequestedAgentAccess | undefined;
const create = () => new AgentAccess(path.join(root, 'profile'), () => requested);
const authorityFile = () => path.join(root, 'profile', 'agent-access-v2.json');
const legacyFile = () => path.join(root, 'profile', 'agent-access-v1.json');

async function allow(access: AgentAccess, change: AgentAccessChange) {
  await access.approve(change, await access.captureReview(change));
}

async function enable(access: AgentAccess) {
  await allow(access, { enabled: true, add: [a], capabilities: ['metadata'] });
}

beforeEach(async () => {
  root = await temporaryRoot('viewer-agent-access-');
  a = path.join(root, 'A');
  b = path.join(root, 'B');
  await fs.mkdir(a);
  await fs.mkdir(b);
  await fs.mkdir(path.join(root, 'profile'));
  requested = { enabled: true, roots: [a], revision: 1 };
});
afterEach(async () => {
  canonicalOverrides.clear();
  await trashTemporary(root);
});

describe('private version-2 agent authority', () => {
  it('withdraws authority and notifies consumers even if persistence fails', async () => {
    const access = create();
    await enable(access);
    const stopped = vi.fn(async () => {});
    const off = access.onWithdrawal(stopped);
    const save = vi
      .spyOn(DocumentStore.prototype, 'save')
      .mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(access.approve({ capabilities: [] })).rejects.toThrow('disk full');
      expect(stopped).toHaveBeenCalledOnce();
      expect(await access.capabilities()).toEqual([]);
      expect((await access.state()).enabled).toBe(true);
    } finally {
      save.mockRestore();
      off();
    }
  });
  it('does not infer approval or capabilities from cold-start configuration', async () => {
    expect(await create().state()).toMatchObject({
      enabled: false,
      roots: [],
      capabilities: [],
      pending: { enable: true, roots: [a] },
      requiresReapproval: false,
    });
    await expect(fs.access(authorityFile())).rejects.toThrow();
    await expect(fs.access(legacyFile())).rejects.toThrow();
  });

  it('preserves ambiguous legacy bytes and requires one native review', async () => {
    const legacy = JSON.stringify({ version: 1, enabled: true, roots: [a] });
    await fs.writeFile(legacyFile(), legacy, { mode: 0o600 });
    const access = create();
    expect(await access.state()).toMatchObject({
      enabled: false,
      roots: [],
      capabilities: [],
      requiresReapproval: true,
    });
    expect(await fs.readFile(legacyFile(), 'utf8')).toBe(legacy);
    await enable(access);
    expect(await fs.readFile(legacyFile(), 'utf8')).toBe(legacy);
    expect((await fs.stat(authorityFile())).mode & 0o777).toBe(0o600);
    expect(await create().state()).toMatchObject({
      enabled: true,
      roots: [a],
      capabilities: ['metadata'],
      requiresReapproval: false,
    });
  });

  it('requires the captured native review for every widening and consumes it once', async () => {
    const access = create();
    const change = { enabled: true, add: [a] };
    await expect(access.approve(change)).rejects.toThrow('native confirmation');
    await expect(access.approve(change, {} as AgentAccessReview)).rejects.toThrow(
      'native confirmation',
    );
    const review = await access.captureReview(change);
    await access.approve(change, review);
    await expect(access.approve(change, review)).rejects.toThrow('native confirmation');
    expect(await access.capabilities()).toEqual([]);
  });

  it('lets configuration narrow access and never widens it on restart', async () => {
    const access = create();
    await enable(access);
    requested = { enabled: true, roots: [a, b], revision: 2 };
    expect(await access.state()).toMatchObject({
      enabled: true,
      roots: [a],
      pending: { enable: false, roots: [b] },
    });
    requested = { enabled: false, roots: [a, b], revision: 3 };
    await access.narrow();
    requested = { enabled: true, roots: [a, b], revision: 4 };
    expect(await create().state()).toMatchObject({
      enabled: false,
      roots: [a],
      pending: { enable: true, roots: [b] },
    });
    await allow(access, { enabled: true, add: [b] });
    expect(await create().state()).toMatchObject({ enabled: true, roots: [a, b] });
  });

  it('rejects stale configuration and private revocation while native review is open', async () => {
    const access = create();
    const change = { enabled: true, add: [a] };
    const outdated = await access.captureReview(change);
    requested = { ...requested!, revision: 2 };
    await expect(access.approve(change, outdated)).rejects.toThrow('changed');
    const revoked = await access.captureReview(change);
    await access.approve({ enabled: false });
    await expect(access.approve(change, revoked)).rejects.toThrow('native confirmation');
    expect((await access.state()).enabled).toBe(false);
  });

  it('rejects a canonical root changed while native review is open', async () => {
    const alias = path.join(root, 'Alias');
    canonicalOverrides.set(alias, a);
    requested = { enabled: true, roots: [alias], revision: 1 };
    const access = create();
    const change = { enabled: true, add: [alias] };
    const review = await access.captureReview(change);
    canonicalOverrides.set(alias, b);
    await expect(access.approve(change, review)).rejects.toThrow('changed');
    expect((await access.state()).enabled).toBe(false);
  });

  it('rejects caller edits to the change after its review was captured', async () => {
    const access = create();
    const change = { enabled: true, add: [a] };
    const review = await access.captureReview(change);
    change.add.push(b);
    await expect(access.approve(change, review)).rejects.toThrow('changed');
    expect((await access.state()).roots).toEqual([]);
  });

  it('removes private folder approval when configuration removes the folder', async () => {
    requested = { enabled: true, roots: [a, b], revision: 1 };
    const access = create();
    await allow(access, { enabled: true, add: [a, b], capabilities: ['metadata'] });
    requested = { enabled: true, roots: [a], revision: 2 };
    await access.narrow();
    requested = { enabled: true, roots: [a, b], revision: 3 };
    expect(await create().state()).toMatchObject({ roots: [a], pending: { roots: [b] } });
  });

  it('narrows explicit capabilities without restoring an implicit all-capability grant', async () => {
    const access = create();
    await enable(access);
    await allow(access, { capabilities: ['metadata', 'navigation'] });
    await access.approve({ capabilities: ['metadata'] });
    expect(await create().capabilities()).toEqual(['metadata']);
    await expect(access.approve({ capabilities: ['metadata', 'content'] })).rejects.toThrow(
      'native confirmation',
    );
  });

  it('fails closed on corrupt v2 and preserves it before an explicit replacement', async () => {
    await fs.writeFile(legacyFile(), JSON.stringify({ version: 1, enabled: true, roots: [a] }));
    await fs.writeFile(authorityFile(), 'Unparseable authority bytes');
    const access = create();
    expect(await access.state()).toMatchObject({ enabled: false, requiresReapproval: true });
    expect(await fs.readFile(authorityFile(), 'utf8')).toBe('Unparseable authority bytes');
    await enable(access);
    const backups = (await fs.readdir(path.dirname(authorityFile()))).filter((file) =>
      file.startsWith('agent-access-v2.json.before-review-'),
    );
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'profile', backups[0]!), 'utf8')).toBe(
      'Unparseable authority bytes',
    );
    expect((await create().state()).enabled).toBe(true);
  });

  it('disables access while configuration is unreadable without losing prior explicit grants', async () => {
    const access = create();
    await enable(access);
    requested = undefined;
    expect((await access.state()).enabled).toBe(false);
    await access.narrow();
    await expect(access.captureReview({ enabled: true })).rejects.toThrow('valid configuration');
    requested = { enabled: true, roots: [a], revision: 2 };
    expect(await access.state()).toMatchObject({ enabled: true, roots: [a] });
  });
});
