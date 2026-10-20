import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentAccess, type RequestedAgentAccess } from '../src/desktop/agent-access';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let a: string;
let b: string;
let requested: RequestedAgentAccess | undefined;
const create = () => new AgentAccess(path.join(root, 'profile'), () => requested);
beforeEach(async () => {
  root = await temporaryRoot('viewer-agent-access-');
  a = path.join(root, 'A');
  b = path.join(root, 'B');
  await fs.mkdir(a);
  await fs.mkdir(b);
  await fs.mkdir(path.join(root, 'profile'));
  requested = { enabled: true, roots: [a] };
});
afterEach(async () => {
  await trashTemporary(root);
});

describe('agent access approval (2026-10-20)', () => {
  it('starts from what config.jsonc already had in effect, kept privately', async () => {
    const access = create();
    expect(await access.state()).toMatchObject({ enabled: true, roots: [a] });
    const file = path.join(root, 'profile', 'agent-access-v1.json');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      version: 1,
      enabled: true,
      roots: [await fs.realpath(a)],
    });
  });
  it('lets config.jsonc narrow access, never widen it', async () => {
    const access = create();
    await access.state();
    requested = { enabled: true, roots: [a, b] };
    expect(await access.state()).toMatchObject({
      enabled: true,
      roots: [a],
      pending: { enable: false, roots: [b] },
    });
    expect((await access.state()).protectedRoots).toEqual([a, b]);
    requested = { enabled: false, roots: [a, b] };
    expect((await access.state()).enabled).toBe(false);
    await access.narrow();
    requested = { enabled: true, roots: [a, b] };
    // turned off in config.jsonc, it is a request again when turned back on there
    expect(await access.state()).toMatchObject({ enabled: false, pending: { enable: true } });
    await access.approve({ enabled: true, add: [b] });
    expect(await create().state()).toMatchObject({ enabled: true, roots: [a, b] });
  });
  it('narrows the approval when config.jsonc removes a folder', async () => {
    requested = { enabled: true, roots: [a, b] };
    const access = create();
    await access.state();
    requested = { enabled: true, roots: [a] };
    await access.narrow();
    requested = { enabled: true, roots: [a, b] };
    expect(await access.state()).toMatchObject({ roots: [a], pending: { roots: [b] } });
  });
  it('turns agents off while config.jsonc cannot be read, and narrows nothing', async () => {
    const access = create();
    await access.state();
    requested = undefined;
    expect((await access.state()).enabled).toBe(false);
    await access.narrow();
    requested = { enabled: true, roots: [a] };
    expect(await access.state()).toMatchObject({ enabled: true, roots: [a] });
  });
  it('seeds nothing while config.jsonc cannot be read', async () => {
    requested = undefined;
    expect((await create().state()).enabled).toBe(false);
    await expect(fs.access(path.join(root, 'profile', 'agent-access-v1.json'))).rejects.toThrow();
  });
});
