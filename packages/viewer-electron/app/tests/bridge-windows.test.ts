/**
 * A request can outlive the window that sent it: the bridge reaches a window only through
 * `requireWindow`/`requireRecord`, which report a closed window instead of crashing on it,
 * and parents a dialog to the window that asked rather than to whichever is selected.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = (file: string) =>
  readFileSync(new URL(`../src/desktop/${file}`, import.meta.url), 'utf8');
const bridge = source('bridge.ts');
// the handler groups that reach a window through the bridge's lookups
const handlers = [
  'access',
  'application',
  'automation',
  'media',
  'pasteboard',
  'setting',
  'window',
].map((group) => source(`ipc/${group}-handlers.ts`));

it('looks up windows only through the checked helpers', () => {
  expect(bridge).not.toMatch(/this\.windows\.get\([^)]*\)!/);
  expect(bridge).not.toMatch(/this\.window!/);
  for (const group of handlers) expect(group).not.toMatch(/[wW]indow\([^)]*\)!/);
  expect(bridge).toContain("throw new Error('The window closed before Viewer could finish.')");
});
