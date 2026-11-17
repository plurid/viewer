import { expect, it } from 'vitest';
import { relativePathLabel } from '../src/domain/files/paths';
import {
  commonFolder,
  fitPathLabel,
  homeText,
  middleName,
  pathCopyText,
  pathLabelParts,
  pathText,
} from '../src/domain/files/path-label';

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

const home = '/Users/fixture';
const measure = (text: string) => text.length;

it.each([
  [home, home, '~'],
  [home + '/', home, '~'],
  [home + '/Jobs/1042', home, '~/Jobs/1042'],
  ['/Users/fixture-other/Jobs', home, '/Users/fixture-other/Jobs'],
  ['/Volumes/Shared/Jobs', home, '/Volumes/Shared/Jobs'],
  ['/fixtures/with\\slash.txt', home, '/fixtures/with\\slash.txt'],
  ['C:\\Users\\fixture\\Jobs', 'C:\\Users\\fixture', '~\\Jobs'],
  ['c:/users/fixture/Jobs', 'C:\\Users\\fixture', '~\\Jobs'],
  ['D:\\Jobs\\1042', 'C:\\Users\\fixture', 'D:\\Jobs\\1042'],
  ['\\\\server\\share\\Jobs', 'C:\\Users\\fixture', '\\\\server\\share\\Jobs'],
  ['/fixtures/Jobs', '', '/fixtures/Jobs'],
])('writes %s with home %s as %s', (path, folder, expected) => {
  expect(pathText(path, folder)).toBe(expected);
});

it('fits a label by dropping names after the anchor, never the item itself', () => {
  const parts = pathLabelParts(home + '/a/bb/ccc/dddd/leaf', home);
  expect(fitPathLabel(parts, 100, measure)).toBe('~/a/bb/ccc/dddd/leaf');
  expect(fitPathLabel(parts, 'x/…/ccc/dddd/leaf'.length, measure)).toBe('~/…/ccc/dddd/leaf');
  expect(fitPathLabel(parts, '~/…/leaf'.length, measure)).toBe('~/…/leaf');
  expect(fitPathLabel(pathLabelParts('/', home), 1, measure)).toBe('/');
});

it('shortens a single long name in its middle, keeping the extension', () => {
  const parts = pathLabelParts(home + '/Jobs/' + 'a'.repeat(40) + '.dxf', home);
  const text = fitPathLabel(parts, 24, measure);
  expect(text).toMatch(/^~\/…\/a+…a+\.dxf$/);
  expect(text.length).toBeLessThanOrEqual(24);
  expect(middleName('report.pdf', () => true)).toBe('report.pdf');
});

it('names home as ~ in messages without touching longer names', () => {
  expect(homeText(`Could not read ${home}/Jobs/a.dxf: denied.`, home)).toBe(
    'Could not read ~/Jobs/a.dxf: denied.',
  );
  expect(homeText(`“${home}” is full.`, home)).toBe('“~” is full.');
  expect(homeText(`${home}-old/a and /Volumes${home}/a`, home)).toBe(
    `${home}-old/a and /Volumes${home}/a`,
  );
  expect(homeText('C:\\USERS\\fixture\\a.txt was moved', 'C:\\Users\\fixture')).toBe(
    '~\\a.txt was moved',
  );
  expect(homeText('No paths here.', '')).toBe('No paths here.');
});

it('names a server location by its server, its starting folder as ~', () => {
  const location = 'viewer-sftp://server01/home/al/Jobs';
  const remote = (id: string) =>
    id === 'server01' ? { host: 'build', user: 'al', home: '/home/al' } : undefined;
  expect(pathText(location, home)).toBe('server:/home/al/Jobs');
  expect(pathText(location, home, { remote })).toBe('al@build:~/Jobs');
  expect(pathText('viewer-sftp://server01/home/al', home, { remote })).toBe('al@build:~');
  expect(pathText('viewer-sftp://server01/srv/x', home, { remote })).toBe('al@build:/srv/x');
  expect(pathText('viewer-sftp://not a connection', home)).toBe('viewer-sftp://not a connection');
  expect(pathCopyText(location, remote)).toBe('al@build:/home/al/Jobs');
  expect(pathCopyText(location)).toBe('server:/home/al/Jobs');
  expect(pathCopyText(home + '/a')).toBe(home + '/a');
});

it('keeps a folder whose name starts with two dots under home', () => {
  expect(pathText(home + '/..cache/x', home)).toBe('~/..cache/x');
  expect(pathText('/Users/fixture-old/x', home)).toBe('/Users/fixture-old/x');
});

it('keeps a UNC share as the anchor while names give way', () => {
  const parts = pathLabelParts('\\\\server\\share\\Jobs\\1042\\drawing.dxf', 'C:\\Users\\al');
  expect(parts.anchor).toBe('\\\\server\\share');
  expect(fitPathLabel(parts, 30, measure)).toBe('\\\\server\\share\\…\\drawing.dxf');
});

it('never returns a label wider than its room', () => {
  const name = 'Release 1.0 notes for the whole team and the customers';
  for (const room of [0, 1, 3, 6, 12, 30, 45]) {
    for (const path of [
      home + '/Jobs/' + name,
      home + '/Jobs/report-final.pdf',
      home,
      '/',
      '/' + 'x'.repeat(60) + '.dxf',
    ]) {
      const text = fitPathLabel(pathLabelParts(path, home), room, measure);
      expect(text.length, `${path} in ${room}`).toBeLessThanOrEqual(room);
    }
  }
  expect(fitPathLabel(pathLabelParts(home + '/Jobs/' + name, home), 30, measure)).toContain(
    'Release',
  );
});

it('treats only a short tail as an extension, never a dot file or a dot inside words', () => {
  const fits = (room: number) => (text: string) => text.length <= room;
  expect(middleName('.' + 'b'.repeat(40), fits(12))).toBe('.bbbbbb…bbbb');
  expect(middleName('Photos 2024.11.17 Wedding party at the lake', fits(20))).not.toContain(
    '.17 Wedding',
  );
  expect(middleName('a'.repeat(30) + '.pdf', fits(12))).toBe('aaaaa…aa.pdf');
  // when even … and the extension are too wide, the extension goes too
  expect(middleName('a'.repeat(30) + '.longext', fits(5))).toBe('aaa…t');
});

it('splits a name between whole characters, never inside an accent or an emoji', () => {
  const accents = middleName('e\u0301'.repeat(30) + '.pdf', (text) => text.length <= 21);
  expect(accents[accents.indexOf('…') + 1]).not.toBe('\u0301');
  const emoji = middleName('😀'.repeat(20) + '.png', (text) => text.length <= 15);
  expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
});

it('isolates a right-to-left name so the folders keep their order', () => {
  const text = pathText(home + '/\u0645\u0634\u0631\u0648\u0639/\u0645\u0644\u0641.pdf', home);
  expect(text).toBe(
    '~/\u2068\u0645\u0634\u0631\u0648\u0639\u2069/\u2068\u0645\u0644\u0641.pdf\u2069',
  );
  expect(pathText(home + '/Jobs', home)).toBe('~/Jobs');
});

it('reads copies from the folder they share, starting at the folder that differs', () => {
  const base = home + '/Clients';
  expect(commonFolder([base + '/Job 1041/3D/part.dxf', base + '/Job 1042/3D/part.dxf'])).toBe(base);
  expect(commonFolder([base + '/a.dxf', base + '/b.dxf'])).toBe(base);
  expect(commonFolder([])).toBe('');
  expect(pathText(base + '/Job 1041/3D/part.dxf', home, { base })).toBe('Job 1041/3D/part.dxf');
  expect(
    fitPathLabel(pathLabelParts(base + '/Job 1041/3D/part.dxf', home, { base }), 19, measure),
  ).toBe('Job 1041/…/part.dxf');
  expect(pathText(base + '/a.dxf', home, { base })).toBe('a.dxf');
});

it('leaves quoted and assigned shell words whole and names home before punctuation', () => {
  expect(homeText(`Command failed: cp '${home}/a b' --to=${home}/x`, home)).toBe(
    `Command failed: cp '${home}/a b' --to=${home}/x`,
  );
  expect(homeText(`Saved in ${home}.`, home)).toBe('Saved in ~.');
  expect(homeText(`Saved in ${home}!`, home)).toBe('Saved in ~!');
  expect(homeText(`Saved in ${home}?`, home)).toBe('Saved in ~?');
  expect(homeText(`[${home}] {${home}}`, home)).toBe('[~] {~}');
  expect(homeText(`${home}.old stays`, home)).toBe(`${home}.old stays`);
});
