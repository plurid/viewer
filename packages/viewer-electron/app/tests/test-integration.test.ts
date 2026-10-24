import { describe, expect, it } from 'vitest';
import { isolatedShellHome } from '../src/desktop/windows/test-integration';

describe('native integration fixtures', () => {
  const options = {
    requested: '/fixtures/profile/shell-home',
    renderTest: true,
    dataDirectory: '/fixtures/profile',
    defaultDataDirectory: '/Users/person/Library/Application Support/Viewer',
  };
  it('permits only an isolated profile descendant as the acceptance shell home', () => {
    expect(isolatedShellHome(options)).toBe(options.requested);
    expect(isolatedShellHome({ ...options, requested: undefined })).toBeUndefined();
    for (const change of [
      { renderTest: false },
      { dataDirectory: undefined },
      { defaultDataDirectory: options.dataDirectory },
      { requested: '/Users/person' },
      { requested: '/fixtures/profile' },
      { requested: '/fixtures/profile/../elsewhere' },
      { requested: 'relative' },
    ])
      expect(() => isolatedShellHome({ ...options, ...change })).toThrow();
  });
});
