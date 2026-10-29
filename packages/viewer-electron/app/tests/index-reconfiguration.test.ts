/**
 * Every background index reconfiguration reports a failure: the locations show offline and the
 * diagnostic log says why. Two paths once dropped the error, and the indexed folders looked
 * silently empty.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const bridge = readFileSync(new URL('../src/desktop/bridge.ts', import.meta.url), 'utf8');

it('reconfigures the index through the one reporting path', () => {
  const calls = [...bridge.matchAll(/this\.configureIndex\(/g)].length;
  // reconfigureIndex itself, and the Rebuild request that reports to the person who asked
  expect(calls).toBe(2);
  expect(bridge).toContain(
    'return this.configureIndex(this.settings.snapshot().settings.search, true)',
  );
  expect(bridge).toMatch(/Index configuration failed: \$\{errorMessage\(error\)\}/);
});
