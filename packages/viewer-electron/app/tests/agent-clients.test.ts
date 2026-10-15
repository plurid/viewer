import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentClients } from '../src/desktop/agent-clients';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { sharedClientID, storedClientID, type AgentClientInput } from '../src/domain/agent-clients';
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
