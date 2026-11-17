import { describe, expect, it, vi } from 'vitest';
import { routeWorkspaceLaunch } from '../src/desktop/windows/workspace-launch';
import { resolveWorkspaceQuery } from '../src/domain/workspaces/definitions/query';
import type { LaunchRequest } from '../src/domain/workspaces/launch';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

const request = (workspace: string): LaunchRequest => ({
  paths: [],
  terminal: false,
  newWindow: false,
  workspace,
});
function ports(current?: { id: string }) {
  return {
    current,
    create: vi.fn(async () => ({ id: 'created' })),
    independent: vi.fn(async () => ({ id: 'independent' })),
    forWorkspace: vi.fn((_id: string): { id: string } | undefined => undefined),
  };
}

describe('workspace query window routing', () => {
  it.each(['unmatched-query', ''])(
    'opens the first window and preserves %s in the picker',
    async (query) => {
      const host = ports();
      const result = resolveWorkspaceQuery([], [], query);
      expect(result.kind).toBe(query ? 'none' : 'picker');
      await expect(routeWorkspaceLaunch(request(query), result, host)).resolves.toEqual({
        target: { id: 'created' },
        request: { ...request(query), workspacePicker: query },
      });
      expect(host.create).toHaveBeenCalledOnce();
      expect(host.independent).not.toHaveBeenCalled();
    },
  );
  it('keeps an ambiguous query in the current window', async () => {
    const host = ports({ id: 'current' });
    const result = resolveWorkspaceQuery(
      [],
      [sampleDefinition('north/site'), sampleDefinition('south/site')],
      'site',
    );
    const routed = await routeWorkspaceLaunch(request('site'), result, host);
    expect(routed).toMatchObject({ target: host.current, request: { workspacePicker: 'site' } });
    expect(host.create).not.toHaveBeenCalled();
  });
  it('uses an owned open workspace and creates an independent window for a definition', async () => {
    const host = ports();
    const open = sampleWorkspace('open');
    host.forWorkspace.mockReturnValue({ id: 'owned' });
    const existing = await routeWorkspaceLaunch(
      request(open.id),
      resolveWorkspaceQuery([open], [], open.id),
      host,
    );
    expect(existing.target).toEqual({ id: 'owned' });
    expect(host.create).not.toHaveBeenCalled();
    const definition = sampleDefinition();
    const defined = await routeWorkspaceLaunch(
      request(definition.key),
      resolveWorkspaceQuery([], [definition], definition.key),
      host,
    );
    expect(defined).toMatchObject({
      target: { id: 'independent' },
      request: { definition: definition.key },
    });
  });
});
