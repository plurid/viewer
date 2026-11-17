import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('records the planned SSH Local Network purpose text before qualification', async () => {
  const adr = await readFile(
    new URL('../../../../docs/adr/0023-remote-planes-over-system-openssh.md', import.meta.url),
    'utf8',
  );
  expect(adr).toContain('NSLocalNetworkUsageDescription');
  expect(adr).toContain('SSH');
});
