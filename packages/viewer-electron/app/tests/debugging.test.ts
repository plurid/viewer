import { describe, expect, it } from 'vitest';
import { debuggingAllowed } from '../src/desktop/diagnostics/debugging';

const profile = '/Users/person/Library/Application Support/Viewer';
describe('DevTools-protocol switches in a packaged build (2026-10-20)', () => {
  it('refuses them on the person’s own profile', () => {
    // Whatever launched Viewer with them had every Viewer API, the person’s bookmarks and tokens included.
    for (const argv of [['--remote-debugging-port=9222'], ['--remote-debugging-pipe']])
      for (const dataDirectory of [undefined, profile])
        expect(
          debuggingAllowed({ packaged: true, argv, dataDirectory, defaultUserData: profile }),
        ).toBe(false);
  });
  it('allows them for a profile of its own, and in development', () => {
    const argv = ['--remote-debugging-port=9222'];
    expect(
      debuggingAllowed({
        packaged: true,
        argv,
        dataDirectory: '/tmp/qa',
        defaultUserData: profile,
      }),
    ).toBe(true);
    expect(debuggingAllowed({ packaged: false, argv, defaultUserData: profile })).toBe(true);
    expect(debuggingAllowed({ packaged: true, argv: ['--mcp'], defaultUserData: profile })).toBe(
      true,
    );
  });
});
