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
  pathWholeText,
  sharedFolder,
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
  // before the connection list arrives, a copy is the location itself, never a made-up address
  expect(pathCopyText(location)).toBe(location);
  expect(pathCopyText(location, () => undefined)).toBe(location);
  expect(pathWholeText(location)).toBe('server:/home/al/Jobs');
  expect(pathWholeText(location, remote)).toBe('al@build:/home/al/Jobs');
  expect(pathWholeText(home + '/a')).toBe(home + '/a');
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
  // ".17 Wedding" has a space: no extension, so the start of the name stays
  expect(middleName('Photos 2024.11.17 Wedding', fits(16))).toBe('Photos 20…edding');
  expect(middleName('a'.repeat(30) + '.pdf', fits(12))).toBe('aaaaa…aa.pdf');
  // nine characters after the dot are a name, not an extension
  expect(middleName('a'.repeat(30) + '.abcdefghi', fits(12))).toBe('aaaaaaa…fghi');
  // when even … and the extension are too wide, the extension goes too
  expect(middleName('a'.repeat(30) + '.longext', fits(5))).toBe('aaa…t');
});

it('splits a name between whole characters, never inside an accent or an emoji', () => {
  // 18 code units leave 13 for the stem: split by code point, an accent would follow the …
  const accents = middleName('e\u0301'.repeat(30) + '.pdf', (text) => text.length <= 18);
  expect(accents).toBe('e\u0301'.repeat(4) + '…' + 'e\u0301'.repeat(2) + '.pdf');
  const thumbs = middleName('👍🏽'.repeat(20) + '.png', (text) => text.length <= 25);
  expect(thumbs).toBe('👍🏽'.repeat(3) + '…' + '👍🏽'.repeat(2) + '.png');
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
  expect(commonFolder([base + '/a.dxf'])).toBe(base);
  expect(pathText(base + '/Job 1041/3D/part.dxf', home, { base })).toBe('Job 1041/3D/part.dxf');
  expect(
    fitPathLabel(pathLabelParts(base + '/Job 1041/3D/part.dxf', home, { base }), 19, measure),
  ).toBe('Job 1041/…/part.dxf');
  expect(pathText(base + '/a.dxf', home, { base })).toBe('a.dxf');
  expect(sharedFolder([base + '/a.dxf', base + '/b/a.dxf'], home)).toBe(base);
  expect(pathText(base + '/b/c/a.dxf', home, { base })).toBe('b/c/a.dxf');
});

it('reads copies from ~ and the root when all they share is the root or the folder of home', () => {
  const atHomeAndBackup = [home + '/Downloads/x.jpg', '/Volumes/Backup/x.jpg'];
  expect(commonFolder(atHomeAndBackup)).toBe('/');
  expect(sharedFolder(atHomeAndBackup, home)).toBe('');
  expect(atHomeAndBackup.map((path) => pathText(path, home, { base: '/' }))).toEqual([
    '~/Downloads/x.jpg',
    '/Volumes/Backup/x.jpg',
  ]);
  const twoPeople = [home + '/Pictures/x.jpg', '/Users/bo/Pictures/x.jpg'];
  expect(commonFolder(twoPeople)).toBe('/Users');
  expect(sharedFolder(twoPeople, home)).toBe('');
  expect(twoPeople.map((path) => pathText(path, home, { base: '/Users' }))).toEqual([
    '~/Pictures/x.jpg',
    '/Users/bo/Pictures/x.jpg',
  ]);
  // a folder elsewhere that does not hold home still tells copies apart
  const backup = ['/Volumes/Backup/2023/x.jpg', '/Volumes/Backup/2024/x.jpg'];
  expect(sharedFolder(backup, home)).toBe('/Volumes/Backup');
  expect(pathText(backup[0]!, home, { base: '/Volumes/Backup' })).toBe('2023/x.jpg');
  expect(sharedFolder(backup, '')).toBe('/Volumes/Backup');
  expect(sharedFolder(['/a.jpg', '/b.jpg'], '')).toBe('');
});

it('names home as ~ in messages, quoted paths too, and before punctuation', () => {
  expect(homeText(`EACCES: permission denied, open '${home}/Private/a.txt'`, home)).toBe(
    "EACCES: permission denied, open '~/Private/a.txt'",
  );
  expect(homeText(`Moved "${home}/a" to --to=${home}/x`, home)).toBe('Moved "~/a" to --to=~/x');
  expect(homeText(`Saved in ${home}.`, home)).toBe('Saved in ~.');
  expect(homeText(`Saved in ${home}!`, home)).toBe('Saved in ~!');
  expect(homeText(`Saved in ${home}?`, home)).toBe('Saved in ~?');
  expect(homeText(`[${home}] {${home}}`, home)).toBe('[~] {~}');
  expect(homeText(`${home}.old stays`, home)).toBe(`${home}.old stays`);
});
