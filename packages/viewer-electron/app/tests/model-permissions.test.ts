import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ModelPermissions } from '../src/desktop/model-permissions';
import { DocumentStore } from '../src/desktop/document-store';
import { newModelProvider } from '../src/domain/model-providers';
import { Credentials, Providers } from '../src/desktop/providers';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let provider: ReturnType<typeof newModelProvider>;
let current: (typeof provider)[];
let permissions: ModelPermissions;
beforeEach(async () => {
  root = await temporaryRoot('viewer-model-permission-');
  provider = { ...newModelProvider('local', 'fixture'), model: 'fixture', allowContent: true };
  current = [provider];
  permissions = new ModelPermissions(root, () => current);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await permissions.close();
  await trashTemporary(root);
});
const signal = () => new AbortController().signal;
describe('private model data authority', () => {
  it('does not infer approval from configuration, a local endpoint or a stored key', async () => {
    const credentials = new Credentials(
      root,
      async (value) => Buffer.from(value),
      async (value) => value.toString(),
    );
    await credentials.set(provider.id, 'fixture-key');
    const request = vi.fn();
    await expect(
      new Providers(credentials, request, permissions).generate(
        provider,
        '',
        [{ filename: 'private.txt' }],
        {},
        signal(),
        'names',
      ),
    ).rejects.toMatchObject({ code: 'MODEL_DATA_PERMISSION_REQUIRED' });
    await expect(
      new Providers(credentials, request).generate(provider, '', [], {}, signal()),
    ).rejects.toThrow('Allow this provider');
    expect(request).not.toHaveBeenCalled();
  });
  it('requires approval for each requested data level', async () => {
    await permissions.set(provider, 'names');
    expect(await permissions.run(provider, 'names', signal(), async () => 'allowed')).toBe(
      'allowed',
    );
    await expect(
      permissions.run(provider, 'excerpts', signal(), async () => 'secret'),
    ).rejects.toThrow('Allow this provider');
    await permissions.set(provider, 'full-text');
    expect(await permissions.run(provider, 'excerpts', signal(), async () => 'allowed')).toBe(
      'allowed',
    );
  });
  it('persists private approvals for cold launch with restrictive file permissions', async () => {
    await permissions.set(provider, 'excerpts');
    const file = path.join(root, 'model-permissions-v1.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const reopened = new ModelPermissions(root, () => current);
    expect((await reopened.get(provider))?.level).toBe('excerpts');
    await reopened.close();
  });
  it('fails closed on corrupt authority without replacing it with a grant', async () => {
    const file = path.join(root, 'model-permissions-v1.json');
    await writeFile(file, '{bad');
    expect(await permissions.get(provider)).toBeNull();
    expect(await readFile(file, 'utf8')).toBe('{bad');
  });
  it('revokes immediately and rejects even a transport that ignores cancellation', async () => {
    await permissions.set(provider, 'full-text');
    let finish!: () => void;
    let runningSignal!: AbortSignal;
    const running = permissions.run(provider, 'names', signal(), async (signal) => {
      runningSignal = signal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return 'late response';
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const rejected = expect(running).rejects.toThrow();
    const revoked = permissions.set(provider, null);
    expect(runningSignal.aborted).toBe(true);
    finish();
    await rejected;
    await revoked;
    expect(await permissions.get(provider)).toBeNull();
  });
  it('does not revive approval after a failed revoke write', async () => {
    await permissions.set(provider, 'full-text');
    vi.spyOn(DocumentStore.prototype, 'save').mockRejectedValueOnce(new Error('disk full'));
    await expect(permissions.set(provider, null)).rejects.toThrow('disk full');
    expect(await permissions.get(provider)).toBeNull();
    await expect(
      permissions.run(provider, 'names', signal(), async () => 'secret'),
    ).rejects.toThrow('Allow this provider');
    await permissions.set(provider, null);
  });
  it('serializes simultaneous approval and revocation without restoring stale authority', async () => {
    await Promise.all([permissions.set(provider, 'full-text'), permissions.set(provider, null)]);
    expect(await permissions.get(provider)).toBeNull();
  });
  it('invalidates approval permanently after an endpoint change, even if configuration is reverted', async () => {
    await permissions.set(provider, 'full-text');
    current = [{ ...provider, endpoint: 'http://localhost:9911/v1' }];
    const first = permissions.reconcile();
    current = [provider];
    await Promise.all([first, permissions.reconcile()]);
    expect(await permissions.get(provider)).toBeNull();
  });
  it('rejects stale providers and removes receipts for a deleted provider', async () => {
    await permissions.set(provider, 'names');
    current = [];
    await permissions.reconcile();
    await expect(permissions.set(provider, 'full-text')).rejects.toThrow('Allow this provider');
    current = [provider];
    expect(await permissions.get(provider)).toBeNull();
  });
  it('does not run new requests or allow new approvals after close', async () => {
    await permissions.set(provider, 'names');
    await permissions.close();
    await expect(
      permissions.run(provider, 'names', signal(), async () => 'secret'),
    ).rejects.toThrow('Allow this provider');
    await expect(permissions.set(provider, 'names')).rejects.toThrow('Allow this provider');
  });
});
