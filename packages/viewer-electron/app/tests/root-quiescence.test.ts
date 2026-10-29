/**
 * Revoking a folder's access and ejecting its volume stop the same services, through one list:
 * eject once missed the watch rules, which stayed attached to the ejected volume.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settleAll } from '../src/domain/settle';

const source = (file: string) =>
  readFileSync(new URL(`../src/desktop/${file}`, import.meta.url), 'utf8');
const bridge = source('bridge.ts');
const handlers = source('ipc/access-handlers.ts');

function body(name: string): string {
  const start = handlers.indexOf(`    ${name}: async`);
  expect(start).toBeGreaterThan(0);
  return handlers.slice(start, handlers.indexOf('\n    },\n', start));
}

describe('quiescing a root', () => {
  it('serves both revoke and eject', () => {
    expect(body('fileAccessRevoke')).toContain('ports.quiesceRoot(root)');
    expect(body('volumeEject')).toContain('ports.quiesceRoot(root)');
    expect(bridge).toContain('quiesceRoot: (root) => this.quiesceRoot(root)');
    const start = bridge.indexOf('  private async quiesceRoot(');
    expect(start).toBeGreaterThan(0);
    const method = bridge.slice(start, bridge.indexOf('\n  }\n', start));
    for (const service of ['watchRules.revoke', 'watchers.revoke', 'terminals.quiesce'])
      expect(method).toContain(`this.${service}(root)`);
  });

  it('lets every participant finish before reporting the first failure', async () => {
    const finished: string[] = [];
    const slow = new Promise<void>((resolve) =>
      setTimeout(() => {
        finished.push('slow');
        resolve();
      }, 20),
    );
    await expect(
      settleAll([Promise.reject(new Error('first')), slow, Promise.reject(new Error('second'))]),
    ).rejects.toThrow('first');
    expect(finished).toEqual(['slow']);
    await expect(settleAll([Promise.resolve(1), undefined])).resolves.toBeUndefined();
  });
});
