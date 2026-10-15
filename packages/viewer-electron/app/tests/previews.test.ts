import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { choosePreview, registerPreview } from '../src/renderer/previews/registry';
import { parseDelimited } from '../src/renderer/previews/parse';
import { lookup } from 'mime-types';
import { fileFamily } from '../src/domain/files';
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
  it('offers Office previews for DOCX/XLSX while leaving old binary and presentation formats to the fallback', () => {
    for (const name of ['Report.docx', 'Budget.xlsx'])
      expect(choosePreview(file(name)).id).toBe('office');
    for (const name of ['Old.doc', 'Old.xls', 'Slides.pptx'])
      expect(choosePreview(file(name)).id).toBe('fallback');
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
