import { describe, expect, it } from 'vitest';
import { pathAncestry, pathContains, relativePathLabel } from '../src/domain/files/paths';
import { remembersFolder, recordVisit } from '../src/domain/files/folder-visits';
import { baseName, normalizedPanePath, parentPath } from '../src/domain/workspaces/planes';
import { planePath, portablePath } from '../src/domain/schemas';
import { desktopPlanePath, localPath } from '../src/desktop/schemas';

const root = 'viewer-sftp://server01/';
const folder = root + 'srv/Project';

describe('location-aware shared path helpers', () => {
  it('keeps a remote root and connection through names, parents and ancestry', () => {
    expect(baseName(root)).toBe('/');
    expect(parentPath(root)).toBe(root);
    expect(baseName(folder)).toBe('Project');
    expect(parentPath(folder)).toBe(root + 'srv');
    expect(pathAncestry(folder)).toEqual([root, root + 'srv', folder]);
    expect(pathAncestry(root)).toEqual([root]);
  });

  it('treats backslashes, percent escapes and Unicode as literal remote name bytes', () => {
    const file = folder + '/résumé%20\\Draft?part#one';
    expect(baseName(file)).toBe('résumé%20\\Draft?part#one');
    expect(parentPath(file)).toBe(folder);
    expect(pathAncestry(file)).toEqual([root, root + 'srv', folder, file]);
    expect(normalizedPanePath(file, 'win32')).toBe(file);
    expect(normalizedPanePath(file, 'darwin')).toBe(file);
  });

  it('compares remote segment boundaries, case and connection identity', () => {
    expect(pathContains(root, folder)).toBe(true);
    expect(pathContains(folder, folder)).toBe(true);
    expect(pathContains(folder, folder + '/file')).toBe(true);
    expect(pathContains(folder, folder + '-other/file')).toBe(false);
    expect(pathContains(folder, root + 'srv/project/file')).toBe(false);
    expect(pathContains(folder, 'viewer-sftp://server02/srv/Project/file')).toBe(false);
    expect(pathContains(folder, '/srv/Project/file')).toBe(false);
    expect(pathContains('/srv/Project', folder + '/file')).toBe(false);
  });

  it('labels same-connection paths relatively without disguising another source', () => {
    expect(relativePathLabel(folder, folder)).toBe('.');
    expect(relativePathLabel(folder, folder + '/file.txt')).toBe('file.txt');
    expect(relativePathLabel(folder, root + 'srv/Elsewhere/file.txt')).toBe(
      '../Elsewhere/file.txt',
    );
    expect(relativePathLabel(root, folder)).toBe('srv/Project');
    expect(relativePathLabel(folder, root)).toBe('../..');
    const other = 'viewer-sftp://server02/srv/Project/file';
    expect(relativePathLabel(folder, other)).toBe(other);
    expect(relativePathLabel(folder, '/srv/Project/file')).toBe('/srv/Project/file');
    expect(relativePathLabel('/srv/Project', folder)).toBe(folder);
  });

  it.each([
    root + 'srv/../Project',
    root + 'srv/./Project',
    root + 'srv//Project',
    folder + '/',
    'viewer-sftp://invalid-id/path',
    'viewer-sftp:/server01/path',
    'VIEWER-SFTP://server01/path',
  ])('refuses a reserved noncanonical pane path without normalizing it: %s', (file) => {
    expect(() => normalizedPanePath(file, 'darwin')).toThrow();
    expect(() => normalizedPanePath(file, 'win32')).toThrow();
  });

  it('retains the existing local path behavior', () => {
    expect(baseName('/work/Project/')).toBe('Project');
    expect(parentPath('/work/Project')).toBe('/work');
    expect(baseName('C:\\Work\\Project\\')).toBe('Project');
    expect(parentPath('C:\\Work')).toBe('C:\\');
    expect(pathAncestry('C:\\Work\\Project')).toEqual(['C:\\', 'C:\\Work', 'C:\\Work\\Project']);
    expect(pathAncestry('/work/Project')).toEqual(['/', '/work', '/work/Project']);
    expect(pathContains('/work', '/work/Project')).toBe(true);
    expect(pathContains('/work', '/worker')).toBe(false);
    expect(relativePathLabel('/work/Project', '/work/Other/file')).toBe('../Other/file');
    expect(normalizedPanePath('/work/./Draft/../Project', 'darwin')).toBe('/work/Project');
    expect(normalizedPanePath('C:\\Work\\Draft\\..\\Project', 'win32')).toBe('c:/work/project');
  });
});

describe('plane path schemas without widening local contracts', () => {
  it('adds explicit plane schemas while local schemas and folder history remain local', () => {
    for (const schema of [planePath, desktopPlanePath]) {
      expect(schema.parse(folder)).toBe(folder);
      expect(schema.parse('/work/Project')).toBe('/work/Project');
      expect(schema.safeParse(root + 'srv/../Project').success).toBe(false);
    }
    expect(planePath.parse('C:\\Work\\Project')).toBe('C:\\Work\\Project');
    expect(portablePath.safeParse(folder).success).toBe(false);
    expect(localPath.safeParse(folder).success).toBe(false);
    expect(remembersFolder(folder)).toBe(false);
    expect(remembersFolder(root + 'srv/../Project')).toBe(false);
    const visits = { '/work/Project': { count: 1, last: 10 } };
    expect(recordVisit(visits, folder, 20)).toBe(visits);
    expect(remembersFolder('/work/Project')).toBe(true);
  });
});
