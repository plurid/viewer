// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasDocument } from '../src/domain/canvases/document';
import { initialize } from '../src/renderer/state/store';
import { ReconstructionPanel } from '../src/renderer/canvases/ReconstructionPanel';
afterEach(cleanup);
it.each([
  ['prepared', 'Prepared'],
  ['submitting', 'Submitting'],
  ['submission-unknown', 'Submission unknown'],
  ['queued', 'Queued'],
  ['running', 'Running'],
  ['cancel-requested', 'Cancellation requested'],
  ['cancelled', 'Canceled'],
  ['succeeded', 'Succeeded'],
  ['failed', 'Failed'],
])('shows a readable %s state and labels empty choices', async (state, label) => {
  const doc = { id: 'canvas', assets: [] } as unknown as CanvasDocument;
  const job = {
    id: 'job',
    prompt: 'Vase',
    state,
    image: 'data:image/png;base64,AA',
    mask: 'data:image/png;base64,AA',
  };
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      reconstruction: vi.fn(async (request: { kind: string }) =>
        request.kind === 'list' ? { jobs: [job] } : { job },
      ),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  render(<ReconstructionPanel document={doc} onClose={() => {}} />);
  expect((await screen.findByRole('status')).textContent).toBe('Vase · ' + label);
  expect((screen.getByRole('button', { name: /No photos/i }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole('button', { name: /No selection models/i }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
