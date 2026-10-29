/**
 * Asking the prompt model what a file is: the desktop service reads 64 bytes of a file the window
 * may read and sends them only at the "excerpts" level; the answer is checked before it is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createModelHandlers } from '../src/desktop/ipc/model-handlers';
import { ModelPermissions } from '../src/desktop/models/model-permissions';
import type { Providers } from '../src/desktop/models/providers';
import type { SettingsService } from '../src/desktop/preferences/settings';
import type { Credentials } from '../src/desktop/models/providers';
import type { ModelDataLevel } from '../src/domain/models/permissions';
import type { ModelProvider } from '../src/domain/services';
import { newModelProvider } from '../src/domain/models/providers';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let permissions: ModelPermissions;
const provider: ModelProvider = {
  ...newModelProvider('local', 'fixture'),
  name: 'Studio model',
  model: 'fixture',
};
beforeEach(async () => {
  root = await temporaryRoot('viewer-file-guess-');
  permissions = new ModelPermissions(root, () => [provider]);
});
afterEach(async () => {
  await permissions.close();
  await trashTemporary(root);
});

/** The handler with a model that answers `answer`, behind the real permission check. */
function handlers(answer: unknown, access = vi.fn(async () => {})) {
  const sent = vi.fn();
  const generate = vi.fn(
    (
      selected: ModelProvider,
      instructions: string,
      input: unknown,
      schema: Record<string, unknown>,
      signal: AbortSignal,
      level: ModelDataLevel = 'full-text',
    ) =>
      permissions.run(selected, level, signal, async () => {
        sent(input);
        return answer;
      }),
  );
  const settings = { ...defaultSettings('/fixtures'), providers: [provider] };
  const identify = createModelHandlers({
    settings: { snapshot: () => ({ settings }) } as unknown as SettingsService,
    credentials: {} as Credentials,
    providers: { generate } as unknown as Providers,
    modelPermissions: permissions,
    fileAccess: { require: access },
    window: () => undefined,
    emit: () => {},
  }).identifyFile;
  return { identify: (file: string) => identify([file], 1), generate, sent, access };
}
const keynote = {
  kind: 'Keynote presentation',
  extension: '.KEY',
  apps: ['Keynote', ' Keynote ', ''],
  note: 'The bytes   begin a ZIP package.',
};

describe('identifyFile', () => {
  it('is refused without permission to send excerpts, and nothing is sent', async () => {
    const file = path.join(root, 'Untitled');
    await writeFile(file, Buffer.alloc(200, 0x41));
    const { identify, generate, sent } = handlers(keynote);
    await expect(identify(file)).rejects.toMatchObject({
      code: 'MODEL_DATA_PERMISSION_REQUIRED',
    });
    // names alone do not cover a file's first bytes
    await permissions.set(provider, 'names');
    await expect(identify(file)).rejects.toMatchObject({
      code: 'MODEL_DATA_PERMISSION_REQUIRED',
    });
    expect(generate.mock.calls[0]?.[5]).toBe('excerpts');
    expect(sent).not.toHaveBeenCalled();
  });

  it('rejects an answer outside its schema', async () => {
    await permissions.set(provider, 'excerpts');
    const file = path.join(root, 'Untitled');
    await writeFile(file, Buffer.from('PK\x03\x04'));
    for (const answer of [
      { ...keynote, apps: ['a', 'b', 'c', 'd', 'e'] },
      { ...keynote, shell: 'open -a Keynote' },
      { ...keynote, kind: '   ' },
      'Keynote',
    ])
      await expect(handlers(answer).identify(file)).rejects.toThrow(
        'The model returned an invalid answer',
      );
  });

  it('sends the name, size and first 64 bytes of a file it may read, and returns a proposal', async () => {
    await permissions.set(provider, 'excerpts');
    const file = path.join(root, 'Untitled');
    const content = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200, 0x7a)]);
    await writeFile(file, content);
    const link = path.join(root, 'Shortcut');
    await symlink(file, link);
    const { identify, sent, access } = handlers(keynote);
    expect(await identify(link)).toEqual({
      provider: 'Studio model',
      kind: 'Keynote presentation',
      extension: 'key',
      apps: ['Keynote'],
      note: 'The bytes begin a ZIP package.',
    });
    expect(access).toHaveBeenCalledWith([link]);
    expect(access).toHaveBeenCalledWith([expect.stringMatching(/Untitled$/)]);
    const input = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({ name: 'Shortcut', size: 216, signature: 'SQLite database' });
    expect((input.firstBytes as string).split(' ')).toHaveLength(64);
    expect(input.printable).toBe('SQLite format 3.' + 'z'.repeat(48));
  });

  it('reads nothing the window may not read', async () => {
    await permissions.set(provider, 'excerpts');
    const denied = vi.fn(async () => {
      throw new Error('Viewer does not have access to this folder.');
    });
    const { identify, generate } = handlers(keynote, denied);
    await expect(identify(path.join(root, 'Untitled'))).rejects.toThrow('does not have access');
    expect(generate).not.toHaveBeenCalled();
  });
});
