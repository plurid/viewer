import { describe, expect, it } from 'vitest';
import { resolveDefinitionPath } from '../src/domain/workspaces/definitions/paths';

const context = {
  home: '/home/sample',
  root: '/projects/primary',
  roots: new Map([['other/server', '/projects/other']]),
  names: new Map([['Other > Server', 'other/server']]),
};
describe('definition path resolution without shell evaluation', () => {
  it.each([
    ['', '/projects/primary'],
    ['.', '/projects/primary'],
    ['{{ROOT}}', '/projects/primary'],
    ['{{ROOT}}/src', '/projects/primary/src'],
    ['src/./api', '/projects/primary/src/api'],
    ['{{ROOT:other/server}}', '/projects/other'],
    ['{{ROOT: Other  > Server }}/src', '/projects/other/src'],
    ['~', '/home/sample'],
    ['~/Documents', '/home/sample/Documents'],
    ['/', '/'],
    ['/absolute/file', '/absolute/file'],
    ['$(touch sample)', '/projects/primary/$(touch sample)'],
  ])('expands %s', (value, expected) =>
    expect(resolveDefinitionPath(value, context)).toBe(expected),
  );
  it.each([
    '..',
    'src/../other',
    '/absolute/../other',
    'a\\b',
    'a\0b',
    'prefix/{{ROOT}}',
    '{{UNKNOWN}}',
    '{{ROOT}}suffix',
    '{{ROOT:missing}}',
    '{{ROOT:{{ROOT}}}}',
    'vscode-remote://host/path',
    '{{ROOT}}/{{UNKNOWN}}',
    '{{ROOT: }}',
    '{{ROOT: }} /src',
    'C:/Users/sample',
    'z:relative',
  ])('refuses %s', (value) => {
    expect(() => resolveDefinitionPath(value, context)).toThrow();
  });
  it.each(['{{ROOT}}', '{{ROOT}}/a', 'relative', '.', ''])(
    'refuses root %s without a named root',
    (value) => {
      expect(() => resolveDefinitionPath(value, { ...context, resolvingRoot: true })).toThrow();
    },
  );
  it('allows a standalone root below another definition or home', () => {
    expect(
      resolveDefinitionPath('{{ROOT:other/server}}/child', { ...context, resolvingRoot: true }),
    ).toBe('/projects/other/child');
    expect(resolveDefinitionPath('~/Projects', { ...context, resolvingRoot: true })).toBe(
      '/home/sample/Projects',
    );
  });
});
