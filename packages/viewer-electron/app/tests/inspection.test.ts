import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  originalMatch,
  searchEvidence,
  sourceVersion,
  sameSourceVersion,
} from '../src/domain/files/inspection';
import { FileIndex } from '../src/desktop/search/index-core';
import { defaultSettings, type DocumentData } from '../src/domain/services';
import { entry } from '../src/desktop/files/filesystem';
import { inspectFile } from '../src/desktop/files/inspection';
import { entity, dxf } from './dxf-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-evidence-');
});
afterEach(async () => {
  await trashTemporary(root);
});
describe('source evidence', () => {
  it('shares exact bounded drawing measurements with the viewer and never assumes missing units', async () => {
    const file = path.join(root, 'Panel.dxf');
    const contents = dxf(
      entity(
        'LWPOLYLINE',
        [90, 4, 70, 1, 10, 0, 20, 0, 10, 200, 20, 0, 10, 200, 20, 100, 10, 0, 20, 100],
      ),
      4,
    );
    await writeFile(file, contents);
    expect((await inspectFile(file)).facts.drawingWidth).toBeUndefined();
    const result = await inspectFile(file, { content: true });
    expect(result.facts.drawingWidth).toMatchObject({ value: 200, unit: 'mm' });
    expect(result.facts.closedContourArea).toMatchObject({ value: 20000, unit: 'mm²' });
    await writeFile(file, contents.replace('$INSUNITS\n70\n4', '$INSUNITS\n70\n0'));
    expect((await inspectFile(file, { content: true })).facts.drawingWidth.unit).toBe('units');
  });
  it('maps folded matching back to original Unicode and line offsets', () => {
    const text = 'First line\nRésumé: Știință, pădure.\nLast line';
    const match = originalMatch(text, 'STIINTA')!;
    expect(text.slice(match.start, match.end)).toBe('Știință');
    const item = { path: '/sample.txt', identity: '1:2', modified: 1, size: 50 } as Awaited<
      ReturnType<typeof entry>
    >;
    const evidence = searchEvidence(
      item,
      {
        path: item.path,
        metadata: {},
        text,
        evidence: [{ source: 'text', text }],
        truncated: false,
      },
      'stiinta',
    )!;
    expect(evidence.quote).toContain('Știință');
    expect(evidence.anchor).toMatchObject({ kind: 'text', line: 2 });
  });
  it('uses real page/chapter anchors and never fabricates a location for metadata', () => {
    const item = { path: '/sample.pdf', identity: '1:2', modified: 1, size: 50 } as Awaited<
      ReturnType<typeof entry>
    >;
    const document: DocumentData = {
      path: item.path,
      metadata: { title: 'Manufacturing' },
      text: 'Manufacturing',
      evidence: [{ source: 'metadata:title', text: 'Manufacturing' }],
      truncated: true,
    };
    expect(searchEvidence(item, document, 'manufacturing')).toBeUndefined();
    document.evidence.push({
      source: 'page 7',
      text: 'Manufacturing details',
      anchor: { kind: 'pdf', page: 7 },
    });
    expect(searchEvidence(item, document, 'manufacturing')).toMatchObject({
      anchor: { kind: 'pdf', page: 7 },
      coverage: 'partial',
    });
    expect(sameSourceVersion(sourceVersion(item), { ...sourceVersion(item), size: 51 })).toBe(
      false,
    );
  });
  it('returns original indexed passages, supports short content queries, and purges them on revocation', async () => {
    const file = path.join(root, 'Notes.txt');
    await writeFile(file, 'Generated test.');
    const index = await FileIndex.open(path.join(root, 'index.sqlite'));
    const scope = {
      ...defaultSettings(root).search,
      roots: [root],
      contentRoots: [root],
      paused: true,
    };
    index.configure(scope);
    const item = await entry(file);
    index.put(item, root, Date.now(), 'One\nȘtiință și AI\nThree');
    const result = index.query({ query: 'stiinta', root, content: true });
    expect(result.evidence?.[0]).toMatchObject({
      quote: 'One\nȘtiință și AI\nThree',
      anchor: { kind: 'text', line: 2 },
    });
    expect(index.query({ query: 'AI', root, content: true }).entries).toHaveLength(1);
    index.configure({ ...scope, contentRoots: [] });
    expect(index.query({ query: 'stiinta', root, content: true }).entries).toHaveLength(0);
    expect(index.query({ query: 'Notes', root, content: true }).evidence).toEqual([]);
    await index.close();
  });
});
