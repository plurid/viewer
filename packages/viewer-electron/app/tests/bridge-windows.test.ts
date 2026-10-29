/**
 * A request can outlive the window that sent it: the bridge reaches a window only through
 * `requireWindow`/`requireRecord`, which report a closed window instead of crashing on it,
 * and parents a dialog to the window that asked rather than to whichever is selected.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const bridge = readFileSync(new URL('../src/desktop/bridge.ts', import.meta.url), 'utf8');

it('looks up windows only through the checked helpers', () => {
  expect(bridge).not.toMatch(/this\.windows\.get\([^)]*\)!/);
  expect(bridge).not.toMatch(/this\.window!/);
  expect(bridge).toContain("throw new Error('The window closed before Viewer could finish.')");
});
