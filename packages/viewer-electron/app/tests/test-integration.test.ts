import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import * as integration from '../src/desktop/windows/test-integration';
import { nativeTestRemovalsBlocked } from '../src/desktop/native/test-removal-policy';

describe('native integration fixtures', () => {
  const options = {
    requested: '/fixtures/profile/shell-home',
    renderTest: true,
    dataDirectory: '/fixtures/profile',
    defaultDataDirectory: '/Users/person/Library/Application Support/Viewer',
  };
  it('permits only an isolated profile descendant as the acceptance shell home', () => {
    expect(integration.isolatedShellHome(options)).toBe(options.requested);
    expect(integration.isolatedShellHome({ ...options, requested: undefined })).toBeUndefined();
    for (const change of [
      { renderTest: false },
      { dataDirectory: undefined },
      { defaultDataDirectory: options.dataDirectory },
      { requested: '/Users/person' },
      { requested: '/fixtures/profile' },
      { requested: '/fixtures/profile/../elsewhere' },
      { requested: 'relative' },
    ])
      expect(() => integration.isolatedShellHome({ ...options, ...change })).toThrow();
  });

  it('requires an isolated non-default profile for backgroundTest and qaRuntime, even across symlinks', async () => {
    const root = await temporaryRoot('viewer-isolated-profile-');
    const defaultProfile = path.join(root, 'default-profile');
    const isolatedProfile = path.join(root, 'isolated-profile');
    const alias = path.join(root, 'alias-profile');
    await mkdir(defaultProfile, { recursive: true });
    await mkdir(isolatedProfile, { recursive: true });
    await symlink(defaultProfile, alias);

    const isBackgroundTest = (
      integration as unknown as {
        isBackgroundTest(input: {
          renderTest: boolean;
          backgroundTest: boolean;
          dataDirectory?: string;
          defaultDataDirectory: string;
        }): boolean;
      }
    ).isBackgroundTest;

    expect(
      isBackgroundTest({
        renderTest: true,
        backgroundTest: true,
        dataDirectory: isolatedProfile,
        defaultDataDirectory: defaultProfile,
      }),
    ).toBe(true);
    for (const dataDirectory of [undefined, 'relative/path', defaultProfile, alias])
      expect(
        isBackgroundTest({
          renderTest: true,
          backgroundTest: true,
          dataDirectory,
          defaultDataDirectory: defaultProfile,
        }),
      ).toBe(false);

    expect(
      nativeTestRemovalsBlocked(
        {
          VIEWER_RENDER_TEST: '1',
          VIEWER_DATA_DIRECTORY: isolatedProfile,
          VIEWER_TEST_NO_REMOVAL: '1',
        },
        defaultProfile,
      ),
    ).toBe(true);
    for (const dataDirectory of [undefined, 'relative/path', defaultProfile, alias])
      expect(
        nativeTestRemovalsBlocked(
          {
            VIEWER_RENDER_TEST: '1',
            ...(dataDirectory === undefined ? {} : { VIEWER_DATA_DIRECTORY: dataDirectory }),
            VIEWER_TEST_NO_REMOVAL: '1',
          },
          defaultProfile,
        ),
      ).toBe(false);
  });
});
