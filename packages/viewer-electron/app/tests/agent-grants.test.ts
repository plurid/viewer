// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ExecutionGrant } from '../src/domain/agents/requests';
import { terminalReadCharacters } from '../src/domain/agents/requests';
import { defaultSettings } from '../src/domain/services';
import { AgentGrants } from '../src/renderer/ui/agents/AgentGrants';

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
  it('names the characters a terminal read keeps, not a byte size (2026-10-30)', () => {
    Object.assign(window, { viewer: { agentGrants: vi.fn(async () => []) } });
    render(
      createElement(AgentGrants, {
        settings: defaultSettings('/Users/person'),
        roots: ['/Users/person/Projects'],
      }),
    );
    expect(
      screen.getByText(
        `the last ${terminalReadCharacters.toLocaleString('en-US')} characters each one showed`,
        { exact: false },
      ),
    ).toBeTruthy();
    expect(terminalReadCharacters).toBe(128_000);
  });
});
