import { describe, it, expect, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AgentClients } from '../src/desktop/agents/agent-clients';
import { agentTools } from '../src/desktop/agents/agent-tools';
import { createAgentHandlers } from '../src/desktop/ipc/agent-handlers';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import {
  agentClientLimit,
  maxAgentReadBytes,
  sharedClientID,
  storedClientID,
} from '../src/domain/agents/clients';
import type { AgentClientInput } from '../src/domain/agents/clients';
const input: AgentClientInput = {
  name: 'Research',
  roots: ['/tmp'],
  capabilities: ['metadata', 'content'],
  budgets: { maxReadBytes: 1048576, maxTasks: 2 },
};
describe('private agent client authority', () => {
  it('keeps reviewed request outcomes, including rejections, across restarts', async () => {
    const root = await temporaryRoot('viewer-client-');
    try {
      const clients = new AgentClients(root, async () => {});
      await clients.audit(
        'review:command',
        'rejected',
        'Move to Trash · 1 items: /a',
        sharedClientID,
      );
      await clients.audit('review:command', 'cancelled', 'Rename', sharedClientID);
      await clients.close();
      const reopened = new AgentClients(root, async () => {});
      expect((await reopened.history()).map((entry) => entry.status)).toEqual([
        'rejected',
        'cancelled',
      ]);
    } finally {
      await trashTemporary(root);
    }
  });
  it('stores only credential hashes, isolates concurrent actor contexts and rechecks revocation', async () => {
    const root = await temporaryRoot('viewer-client-');
    const clients = new AgentClients(root, async () => {});
    try {
      const first = await clients.create(input),
        second = await clients.create({
          ...input,
          name: 'Navigation',
          capabilities: ['navigation'],
        });
      expect(await clients.authenticate(first.token)).toBe(first.client.id);
      expect(await clients.authenticate('wrong')).toBeUndefined();
      expect(await readFile(path.join(root, 'agent-clients-v1.json'), 'utf8')).not.toContain(
        first.token,
      );
      expect(JSON.stringify(await clients.list())).not.toContain('tokenHash');
      await Promise.all([
        clients.context.run(first.client.id, async () => {
          await clients.require('content');
          await new Promise((resolve) => setTimeout(resolve, 2));
          expect(clients.actor()).toBe(first.client.id);
        }),
        clients.context.run(second.client.id, async () => {
          await clients.require('navigation');
          await expect(clients.require('content')).rejects.toThrow('no content');
          expect(clients.actor()).toBe(second.client.id);
        }),
      ]);
      await clients.update(first.client.id, first.client.revision);
      expect(await clients.authenticate(first.token)).toBeUndefined();
      await expect(clients.require('content', first.client.id)).rejects.toThrow('revoked');
      await clients.close();
      const cold = new AgentClients(root, async () => {});
      expect(await cold.authenticate(second.token)).toBe(second.client.id);
      expect(await cold.authenticate(first.token)).toBeUndefined();
      await cold.close();
    } finally {
      await clients.close();
      await trashTemporary(root);
    }
  });
  it('uses revisioned private updates, denies invalid roots before saving and records bounded ordered activity', async () => {
    const root = await temporaryRoot('viewer-client-');
    const clients = new AgentClients(root, async (roots) => {
      if (roots.includes('/denied')) throw new Error('Permission denied');
    });
    try {
      await expect(clients.create({ ...input, roots: ['/denied'] })).rejects.toThrow(
        'Permission denied',
      );
      const value = await clients.create(input);
      const updated = await clients.update(value.client.id, 1, {
        ...input,
        capabilities: ['metadata'],
      });
      expect(updated.revision).toBe(2);
      await expect(clients.update(value.client.id, 1, input)).rejects.toThrow('changed');
      await expect(clients.require('content', value.client.id)).rejects.toThrow('no content');
      await clients.context.run(value.client.id, async () => {
        await Promise.all([
          clients.audit('read_metadata', 'completed', 'Read'),
          clients.audit('read_content', 'failed', 'Denied'),
        ]);
      });
      expect((await clients.history(value.client.id)).map((entry) => entry.tool)).toEqual([
        'read_metadata',
        'read_content',
      ]);
      await clients.close();
    } finally {
      await clients.close();
      await trashTemporary(root);
    }
  });
});
describe('shared connection', () => {
  it('reads grants and records stored under the earlier client ID as the shared client', () => {
    expect(storedClientID.parse('legacy')).toBe(sharedClientID);
    expect(storedClientID.parse('a-named-client')).toBe('a-named-client');
  });
});
describe('removing revoked clients (2026-10-30)', () => {
  // Creating stopped at 100 records, revoked ones included, and nothing could remove one.
  const saved = (revoked: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: agentClientLimit }, (_, index) => ({
      ...input,
      name: 'Client ' + index,
      id: randomUUID(),
      revision: 1,
      created: index,
      revoked: index < revoked,
      tokenHash: '0'.repeat(64),
      ...extra,
    }));
  it('refuses a new client with the counts behind the limit, then creates it once a revoked one is removed', async () => {
    const root = await temporaryRoot('viewer-client-limit-');
    const records = saved(37);
    await writeFile(path.join(root, 'agent-clients-v1.json'), JSON.stringify(records));
    const clients = new AgentClients(root, async () => {});
    try {
      await expect(clients.create(input)).rejects.toThrow(
        'Viewer keeps up to 100 agent clients and has 100: 63 active and 37 revoked. ' +
          'Remove a revoked client, then create this one.',
      );
      const active = records[agentClientLimit - 1];
      await expect(clients.remove(active.id, 1)).rejects.toThrow(
        'Revoke Client 99 before removing it.',
      );
      await expect(clients.remove(records[0].id, 2)).rejects.toThrow('changed');
      const left = await clients.remove(records[0].id, 1);
      expect(left).toHaveLength(agentClientLimit - 1);
      expect(left.some((client) => client.id === records[0].id)).toBe(false);
      const created = await clients.create(input);
      expect(await clients.authenticate(created.token)).toBe(created.client.id);
      await clients.close();
      const cold = new AgentClients(root, async () => {});
      expect((await cold.list()).map((client) => client.id)).not.toContain(records[0].id);
      await cold.close();
    } finally {
      await clients.close();
      await trashTemporary(root);
    }
  });
  it('says to revoke one first when every kept client is active', async () => {
    const root = await temporaryRoot('viewer-client-limit-');
    await writeFile(path.join(root, 'agent-clients-v1.json'), JSON.stringify(saved(0)));
    const clients = new AgentClients(root, async () => {});
    try {
      await expect(clients.create(input)).rejects.toThrow(
        'Viewer keeps up to 100 agent clients, and all 100 are active. ' +
          'Revoke one you no longer use and remove it, then create this one.',
      );
    } finally {
      await clients.close();
      await trashTemporary(root);
    }
  });
  it('reads a budget saved while 64 MiB was allowed as the largest allowed now', async () => {
    const root = await temporaryRoot('viewer-client-budget-');
    const [record] = saved(0, { budgets: { maxReadBytes: 64 * 1024 * 1024, maxTasks: 2 } });
    await writeFile(path.join(root, 'agent-clients-v1.json'), JSON.stringify([record]));
    const clients = new AgentClients(root, async () => {});
    try {
      expect((await clients.list())[0].budgets).toEqual({
        maxReadBytes: maxAgentReadBytes,
        maxTasks: 2,
      });
      expect(() =>
        clients.create({ ...input, budgets: { maxReadBytes: maxAgentReadBytes + 1, maxTasks: 2 } }),
      ).toThrow('Too big');
    } finally {
      await clients.close();
      await trashTemporary(root);
    }
  });
  it('offers agents no way to remove a client', async () => {
    expect(agentTools.filter((tool) => /client/i.test(tool.name))).toEqual([]);
    const clientRequest = vi.fn(async () => []);
    const handlers = createAgentHandlers({
      sessions: { request: vi.fn() },
      requests: { list: vi.fn(), review: vi.fn(), listGrants: vi.fn(), grant: vi.fn() },
      broker: { clientRequest } as never,
      isAgent: () => true,
      changeAccess: vi.fn(),
    });
    await expect(
      handlers.agentClients([{ kind: 'remove', id: randomUUID(), revision: 2 }], 1),
    ).rejects.toThrow('Only you can remove an agent client');
    expect(clientRequest).not.toHaveBeenCalled();
  });
});
