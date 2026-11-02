import { expect, it } from 'vitest';
import { relativePathLabel } from '../src/domain/files/paths';

it.each([
  ['/project', '/project/Inputs/brief.json', 'Inputs/brief.json'],
  ['/project/', '/project', '.'],
  ['/', '/project', 'project'],
  ['/project/job', '/project/shared/a.dxf', '../shared/a.dxf'],
  ['/project/job', '/project/jobs/a.dxf', '../jobs/a.dxf'],
  ['/project', '/project/șurub plate.dxf', 'șurub plate.dxf'],
  ['/project', '/project/with\\slash.txt', 'with\\slash.txt'],
  ['C:\\Work\\Job', 'c:/work/job/Inputs/brief.json', 'Inputs\\brief.json'],
  ['C:\\Work\\Job', 'C:\\Work\\Shared\\brief.json', '..\\Shared\\brief.json'],
  ['C:\\Work', 'D:\\Work\\brief.json', 'D:\\Work\\brief.json'],
  ['\\\\server\\share\\Job', '\\\\server\\share\\Sources\\base.stl', '..\\Sources\\base.stl'],
  ['\\\\server\\share\\Job', '\\\\server\\other\\base.stl', '\\\\server\\other\\base.stl'],
])('labels %s → %s without changing the navigation target', (folder, file, expected) => {
  expect(relativePathLabel(folder, file)).toBe(expected);
});
