// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ExecutionGrant } from '../src/domain/agent-requests';
import { defaultSettings } from '../src/domain/services';
import { AgentGrants } from '../src/renderer/ui/AgentGrants';

afterEach(cleanup);

describe('agent grant settings', () => {
  it('shows a grant made through a linked folder as granted for that folder', async () => {
    const grants: ExecutionGrant[] = [
      {
        id: 'grant',
        clientID: 'shared',
        actionID: '*',
        root: '/Volumes/Work/Projects',
        chosen: '/Users/person/Projects',
        fingerprint: '',
        capability: 'terminal-read',
      },
    ];
    Object.assign(window, { viewer: { agentGrants: vi.fn(async () => grants) } });
    render(
      createElement(AgentGrants, {
        settings: defaultSettings('/Users/person'),
        roots: ['/Users/person/Projects'],
      }),
    );
    const box = screen.getByRole('checkbox', { name: /Read terminal output/ });
    await vi.waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
  });
});
