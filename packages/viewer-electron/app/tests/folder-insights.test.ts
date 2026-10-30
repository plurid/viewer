/**
 * A folder shows a few insight cards above its files: old installers in Downloads, archives already
 * extracted, large PDFs, loose screenshots, HEIC photos and names that look like copies. Each is
 * computed from the listing alone and offers one command on exactly the files concerned; a
 * dismissed card stays hidden for its folder.
 */
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { formatBytes } from '../src/domain/files/entries';
import {
  folderInsights,
  rememberDismissal,
  type InsightInput,
} from '../src/domain/suggestions/insights';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { preferencesSchema } from '../src/domain/preferences/presentation/ui-schema';

const now = Date.UTC(2026, 9, 29);
const day = 24 * 60 * 60 * 1000;
const megabytes = 1_000_000;
const home = '/Users/a';
const downloads = home + '/Downloads';
const documents = home + '/Documents';
const file = (
  name: string,
  { parent = documents, size = 1000, age = 1, hidden = false } = {},
): FileEntry => {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const mime =
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      heic: 'image/heic',
      heif: 'image/heif',
      mov: 'video/quicktime',
      pdf: 'application/pdf',
    }[extension] ?? 'application/octet-stream';
  return {
    path: parent + '/' + name,
    parent,
    name,
    extension,
    kind: 'file',
    directory: false,
    size,
    modified: now - age * day,
    created: now - age * day,
    hidden,
    mime,
    identity: parent + '/' + name,
  };
};
const folder = (name: string, parent = documents): FileEntry => ({
  ...file(name, { parent }),
  extension: '',
  kind: 'directory',
  directory: true,
  mime: '',
});
const insights = (
  entries: FileEntry[],
  extra: Partial<InsightInput> = {},
  parent = entries[0]?.parent ?? documents,
) => folderInsights({ folder: parent, entries, now, home, ...extra });
const ids = (value: ReturnType<typeof insights>) => value.map((insight) => insight.id);
const screenshots = (count: number, parent = documents) =>
  Array.from({ length: count }, (_, index) =>
    file(`Screenshot 2026-10-${10 + index} at 09.41.00.png`, { parent }),
  );

describe('each rule', () => {
  it('names extracted archives for the Trash', () => {
    const entries = [
      file('Photos.zip', { size: 3 * megabytes }),
      folder('Photos'),
      file('backup.tar.gz', { size: megabytes }),
      folder('backup'),
      file('site.tgz'),
      folder('site'),
      file('logs.tar'),
      folder('logs'),
    ];
    const [insight] = insights(entries);
    expect(insight).toEqual({
      id: 'archives.extracted',
      title: '4 archives already extracted',
      detail: `Photos.zip, backup.tar.gz and 2 more · ${formatBytes(4 * megabytes + 2000)}`,
      command: 'trash',
      action: 'Move to Trash',
      paths: [
        documents + '/Photos.zip',
        documents + '/backup.tar.gz',
        documents + '/site.tgz',
        documents + '/logs.tar',
      ],
      target: 'files',
    });
  });

  it('names week-old installers in Downloads for the Trash', () => {
    const entries = [
      file('Setup.dmg', { parent: downloads, age: 12, size: 200 * megabytes }),
      file('Driver.pkg', { parent: downloads, age: 30 }),
      file('Fresh.dmg', { parent: downloads, age: 2 }),
    ];
    const [insight] = insights(entries);
    expect(insight).toMatchObject({
      id: 'downloads.installers',
      title: '2 installers older than a week',
      detail: `Setup.dmg and Driver.pkg · ${formatBytes(200 * megabytes + 1000)}`,
      command: 'trash',
      action: 'Move to Trash',
      paths: [downloads + '/Setup.dmg', downloads + '/Driver.pkg'],
      target: 'files',
    });
  });

  it('gathers five or more screenshots and recordings into a folder', () => {
    const entries = [
      ...screenshots(2),
      file('Screen Shot 2020-01-01 at 10.00.00.png'),
      file('Screen Recording 2026-10-01 at 10.00.00.mov'),
      file('CleanShot 2026-10-02 at 11.00.00.png'),
      file('Screenshots.md'),
    ];
    const [insight] = insights(entries);
    expect(insight).toMatchObject({
      id: 'screenshots',
      title: '5 screenshots',
      command: 'new-folder-with-selection',
      action: 'Put in a folder',
      target: 'files',
    });
    expect(insight!.paths).toHaveLength(5);
    expect(insight!.paths).not.toContain(documents + '/Screenshots.md');
    expect(ids(insights(entries.slice(1)))).toEqual([]);
  });

  it('offers to optimize PDFs over 10 MB', () => {
    const entries = [
      file('Scan.pdf', { size: 18 * megabytes }),
      file('Exactly.pdf', { size: 10 * megabytes }),
      file('Small.pdf', { size: megabytes }),
    ];
    expect(insights(entries)).toEqual([
      expect.objectContaining({
        id: 'pdfs.large',
        title: '1 PDF over 10 MB',
        command: 'optimize-files',
        action: 'Optimize',
        paths: [documents + '/Scan.pdf'],
      }),
    ]);
  });

  it('offers JPEG copies of three or more HEIC photos', () => {
    const entries = [file('IMG_1.heic'), file('IMG_2.HEIC'), file('IMG_3.heif')];
    expect(insights(entries)).toEqual([
      expect.objectContaining({
        id: 'photos.heic',
        title: '3 HEIC photos',
        command: 'convert-jpeg',
        action: 'Convert copies to JPEG',
        paths: entries.map((entry) => entry.path),
      }),
    ]);
    expect(insights(entries.slice(1))).toEqual([]);
  });

  it('finds duplicates in the folder when two or more names look like copies', () => {
    const entries = [
      file('Report copy.pdf'),
      file('Report copy 2.pdf'),
      file('Invoice (1).pdf'),
      file('Notes.md'),
    ];
    expect(insights(entries)).toEqual([
      expect.objectContaining({
        id: 'names.copies',
        title: '3 files named as copies',
        detail: 'Report copy.pdf, Report copy 2.pdf and 1 more',
        command: 'find-duplicates',
        action: 'Find duplicates',
        target: 'folder',
      }),
    ]);
    expect(insights(entries.slice(2))).toEqual([]);
  });
});

describe('what counts', () => {
  it('needs a sibling folder of the archive’s own stem', () => {
    expect(insights([file('Photos.zip')])).toEqual([]);
    expect(insights([file('Photos.zip'), folder('Pictures')])).toEqual([]);
    // a file of that name is not what Extract here made
    expect(insights([file('Photos.zip'), file('Photos')])).toEqual([]);
    expect(insights([file('Photos.zip'), folder('Photos.zip.d')])).toEqual([]);
    expect(ids(insights([folder('Photos'), file('Photos.zip')]))).toEqual(['archives.extracted']);
  });

  it('looks for installers only in Home’s own Downloads', () => {
    const old = { age: 12 };
    expect(insights([file('Setup.dmg', { ...old, parent: documents })])).toEqual([]);
    expect(insights([file('Setup.dmg', { ...old, parent: '/Users/b/Downloads' })])).toEqual([]);
    expect(insights([file('Setup.dmg', { ...old, parent: downloads + '/Older' })])).toEqual([]);
    expect(insights([file('Setup.dmg', { age: 6, parent: downloads })])).toEqual([]);
    expect(ids(insights([file('Setup.dmg', { ...old, parent: downloads })]))).toEqual([
      'downloads.installers',
    ]);
    const windows = 'C:\\Users\\a';
    expect(
      folderInsights({
        folder: windows + '\\Downloads',
        entries: [file('Setup.dmg', { ...old, parent: windows + '\\Downloads' })],
        now,
        home: windows,
      }).map((insight) => insight.id),
    ).toEqual(['downloads.installers']);
  });

  it('leaves out hidden items and folders', () => {
    expect(insights(screenshots(5).map((entry) => ({ ...entry, hidden: true })))).toEqual([]);
    expect(insights([folder('Photos'), { ...file('Photos.zip'), hidden: true }])).toEqual([]);
    const folders = ['A copy', 'B copy', 'C copy'].map((name) => folder(name));
    expect(insights(folders)).toEqual([]);
  });
});

describe('the cards', () => {
  const everything = [
    file('IMG_1.heic', { parent: downloads }),
    file('IMG_2.heic', { parent: downloads }),
    file('IMG_3.heic', { parent: downloads }),
    file('Report copy.pdf', { parent: downloads }),
    file('Report (1).pdf', { parent: downloads }),
    ...screenshots(6, downloads),
    file('Scan.pdf', { parent: downloads, size: 20 * megabytes }),
    file('Photos.zip', { parent: downloads }),
    folder('Photos', downloads),
    file('Setup.dmg', { parent: downloads, age: 40 }),
  ];

  it('shows three at most, strongest first', () => {
    expect(ids(insights(everything))).toEqual([
      'downloads.installers',
      'archives.extracted',
      'pdfs.large',
    ]);
    expect(ids(insights(everything, { limit: Infinity }))).toEqual([
      'downloads.installers',
      'archives.extracted',
      'pdfs.large',
      'names.copies',
      'screenshots',
      'photos.heic',
    ]);
  });

  it('keeps the listing’s order within a card, whatever order the entries come in', () => {
    const reversed = insights([...everything].reverse(), { limit: Infinity });
    const forward = insights(everything, { limit: Infinity });
    expect(reversed.map((insight) => insight.id)).toEqual(forward.map((insight) => insight.id));
    const heic = (value: typeof forward) => value.find((item) => item.id === 'photos.heic')!.paths;
    expect(heic(reversed)).toEqual([...heic(forward)].reverse());
  });

  it('leaves a dismissed card out, and the next takes its place', () => {
    expect(
      ids(insights(everything, { dismissed: ['archives.extracted', 'downloads.installers'] })),
    ).toEqual(['pdfs.large', 'names.copies', 'screenshots']);
  });

  it('has nothing to say about an ordinary folder', () => {
    expect(insights([file('a.txt'), folder('src'), file('b.png')])).toEqual([]);
    expect(insights([])).toEqual([]);
  });
});

describe('dismissals', () => {
  it('keeps the latest folder last, each id once, and bounds what it keeps', () => {
    let dismissed: Record<string, string[]> = {};
    dismissed = rememberDismissal(dismissed, '/a', 'screenshots');
    dismissed = rememberDismissal(dismissed, '/b', 'pdfs.large');
    dismissed = rememberDismissal(dismissed, '/a', 'screenshots');
    dismissed = rememberDismissal(dismissed, '/a', 'photos.heic');
    expect(dismissed).toEqual({ '/b': ['pdfs.large'], '/a': ['screenshots', 'photos.heic'] });
    expect(Object.keys(dismissed)).toEqual(['/b', '/a']);
    for (let index = 0; index < 30; index++)
      dismissed = rememberDismissal(dismissed, '/a', 'x' + index);
    expect(dismissed['/a']).toHaveLength(20);
    expect(dismissed['/a']!.at(-1)).toBe('x29');
    for (let index = 0; index < 250; index++)
      dismissed = rememberDismissal(dismissed, '/folder' + index, 'screenshots');
    expect(Object.keys(dismissed)).toHaveLength(200);
    expect(Object.keys(dismissed).at(-1)).toBe('/folder249');
    expect(preferencesSchema.shape.insightsDismissed.safeParse(dismissed).success).toBe(true);
  });

  it('normalises what was saved, keeping the latest two hundred folders', () => {
    const saved = Object.fromEntries(
      Array.from({ length: 210 }, (_, index) => ['/folder' + index, ['screenshots']]),
    );
    const normal = normalizePreferences({
      insightsDismissed: {
        ...saved,
        'relative/path': ['screenshots'],
        '/ids': ['pdfs.large', 'pdfs.large', 7, '', 'x'.repeat(61)],
        '/empty': [],
        '/broken': 'screenshots',
        '/many': Array.from({ length: 30 }, (_, index) => 'id' + index),
      },
    }).insightsDismissed!;
    expect(Object.keys(normal)).toHaveLength(200);
    expect(normal).not.toHaveProperty('relative/path');
    expect(normal).not.toHaveProperty('/empty');
    expect(normal).not.toHaveProperty('/broken');
    expect(normal).not.toHaveProperty('/folder0');
    expect(normal['/ids']).toEqual(['pdfs.large']);
    expect(normal['/many']).toHaveLength(20);
    expect(preferencesSchema.shape.insightsDismissed.safeParse(normal).success).toBe(true);
    expect(normalizePreferences().insightsDismissed).toEqual({});
    expect(normalizePreferences({ insightsDismissed: ['/a'] }).insightsDismissed).toEqual({});
  });

  it('refuses more than two hundred folders or twenty ids in the configuration', () => {
    const schema = preferencesSchema.shape.insightsDismissed;
    const folders = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => ['/folder' + index, ['screenshots']]),
    );
    expect(schema.safeParse(folders).success).toBe(false);
    expect(schema.safeParse({ '/a': Array.from({ length: 21 }, (_, i) => 'id' + i) }).success).toBe(
      false,
    );
    expect(schema.safeParse({ 'relative/path': ['screenshots'] }).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});
