import { describe, expect, it } from 'vitest';
import path from 'node:path';
import type { FileEntry } from '../src/domain/contracts';
import { choosePreview, registerPreview } from '../src/renderer/previews/registry';
import { previewState } from '../src/renderer/previews/state';
import { parseDelimited } from '../src/renderer/previews/parse';
import { lookup } from 'mime-types';
import { fileFamily } from '../src/domain/files/entries';
const file = (name: string): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension: name.split('.').pop() || '',
  mime: 'application/octet-stream',
  size: 0,
  kind: 'file',
  directory: false,
  identity: 'fixture',
  modified: 0,
  created: 0,
  hidden: false,
});
describe('preview extension contract', () => {
  it.each(['html', 'htm', 'xhtml'])(
    'renders .%s documents before the generic text preview',
    (extension) => {
      expect(choosePreview(file(`page.${extension}`)).id).toBe('html');
    },
  );
  it('offers layout previews for Office, its macro and template variants, OpenDocument and RTF', () => {
    for (const name of [
      'Report.docx',
      'Budget.xlsx',
      'Old.doc',
      'Old.xls',
      'Slides.ppt',
      'Slides.pptx',
      'Report.docm',
      'Budget.xltx',
      'Show.ppsx',
      'Notes.odt',
      'Sheet.fods',
      'Plan.odg',
      'Letter.rtf',
    ])
      expect(choosePreview(file(name)).id).toBe('office');
    // binary workbooks have no engine filter; Keynote shows the picture it saved, not a layout
    expect(choosePreview(file('Budget.xlsb')).id).toBe('fallback');
    expect(choosePreview(file('Slides.key')).id).toBe('embedded');
  });
  it('routes the formats added beside Office to their own modules', () => {
    const routes = {
      'Field notes.ipynb': 'notebook',
      'Trip.ics': 'cards',
      'Friends.vcf': 'cards',
      'Episode.srt': 'subtitles',
      'Episode.vtt': 'subtitles',
      'Library.sqlite': 'sqlite',
      'cache.db': 'sqlite',
      'Source Sans.woff2': 'font',
      'Mod.jar': 'archive',
      'Comic.cbz': 'archive',
      'Scan.pbm': 'rendered-image',
      'Scan.jfif': 'image',
      'Clip.wmv': 'media',
      'Voice.wma': 'media',
      'Main.scala': 'text',
      'Places.geojson': 'text',
    };
    for (const [name, module] of Object.entries(routes))
      expect([name, choosePreview(file(name)).id]).toEqual([name, module]);
  });
  it('expands a single gzip file and lists a compressed TAR as an archive', () => {
    const routes = {
      'notes.txt.gz': 'compressed',
      'data.json.gz': 'compressed',
      'access.log.gz': 'compressed',
      'report.csv.gz': 'compressed',
      'access.log.2.gz': 'compressed',
      'Field notes.tar.gz': 'archive',
      'BACKUP.TAR.GZ': 'archive',
      'Field notes.tgz': 'archive',
    };
    for (const [name, module] of Object.entries(routes))
      expect([name, choosePreview({ ...file(name), mime: 'application/gzip' }).id]).toEqual([
        name,
        module,
      ]);
  });
  it('routes DXF drawings ahead of ambiguous text or image MIME and gives them a drawing icon', () => {
    for (const mime of ['application/octet-stream', 'image/vnd.dxf', 'text/plain']) {
      const drawing = { ...file('cut.dxf'), mime };
      expect(choosePreview(drawing).id).toBe('dxf');
      expect(fileFamily(drawing)).toBe('drawing');
    }
  });
  it('prefers a source-code extension over ambiguous system MIME mappings', () => {
    const typescript = { ...file('workspace.ts'), mime: lookup('workspace.ts') || '' };
    expect(choosePreview(typescript).id).toBe('text');
    expect(fileFamily(typescript)).toBe('code');
    expect(choosePreview({ ...file('reference.svg'), mime: 'image/svg+xml' }).id).toBe('image');
    expect(choosePreview({ ...file('movie.mp4'), mime: 'video/mp4' }).id).toBe('media');
  });
  it('previews dotfiles by name, which the file system gives no extension', () => {
    // As the desktop lists them: `path.extname('.env')` is empty.
    const dotfile = (name: string) => ({ ...file(name), extension: path.extname(name).slice(1) });
    for (const name of ['.env', '.gitignore', '.env.local', '.ENV'])
      expect(choosePreview(dotfile(name)).id).toBe('text');
    for (const name of ['.DS_Store', '.localized'])
      expect(choosePreview(dotfile(name)).id).toBe('fallback');
  });
  it('routes every initial 3D format through the lazy model module', () => {
    for (const extension of [
      'glb',
      'gltf',
      'obj',
      'stl',
      'fbx',
      'step',
      'stp',
      'iges',
      'igs',
      '3mf',
      'ply',
    ])
      expect(choosePreview(file(`model.${extension}`)).id).toBe('model');
  });
  it('does not claim unsupported creative formats are raster images', () => {
    for (const extension of ['ai', 'usd'])
      expect(choosePreview(file(`file.${extension}`)).id).toBe('fallback');
    // Chromium cannot decode these; Quick Look renders them out of process instead.
    for (const extension of ['psd', 'heic', 'tiff', 'dng'])
      expect(choosePreview(file(`file.${extension}`)).id).toBe('rendered-image');
  });
  it('supports a new typed module without changing the explorer or engine', () => {
    const remove = registerPreview({
      id: 'test-custom',
      label: 'Custom',
      formats: ['example'],
      detect: (entry) => (entry.extension === 'example' ? 120 : 0),
      load: async () => ({ default: () => null }),
    });
    expect(choosePreview(file('file.example')).id).toBe('test-custom');
    remove();
    expect(choosePreview(file('file.example')).id).toBe('fallback');
  });
  it('parses quoted CSV fields, newlines, escaped quotes, and malformed input', () => {
    expect(parseDelimited('name,note\r\n"A, B","line one\nline ""two"""').rows).toEqual([
      ['name', 'note'],
      ['A, B', 'line one\nline "two"'],
    ]);
    expect(parseDelimited('a,"unclosed').malformed).toBe(true);
    expect(parseDelimited('a\tb\n1\t2', '\t').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
describe('session preview state (2026-10-20)', () => {
  it('resets a temporary preview’s view when its file changes, keeping notes', () => {
    // Quick Preview, Gallery and Columns kept a file's DXF measurements, PDF page and sheet across
    // versions, though a workspace preview plane resets them.
    const version = (modified: number) =>
      ({ path: '/fixture/plan.dxf', identity: '1:7', modified, size: 10 }) as FileEntry;
    const first = previewState('/fixture/plan.dxf', version(1));
    first.set('dxf.measurements', ['m']);
    first.set('notes.text', 'kept');
    const same = previewState('/fixture/plan.dxf', version(1));
    expect(same.get('dxf.measurements')).toEqual(['m']);
    const changed = previewState('/fixture/plan.dxf', version(2));
    expect(changed.get('dxf.measurements')).toBeUndefined();
    expect(changed.get('notes.text')).toBe('kept');
    changed.set('dxf.page', 2);
    expect(previewState('/fixture/plan.dxf', version(2)).get('dxf.measurements')).toBeUndefined();
    expect(previewState('/fixture/plan.dxf', version(2)).get('dxf.page')).toBe(2);
  });
});
