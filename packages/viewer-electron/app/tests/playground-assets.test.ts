import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Mesh } from 'three';
import type { Object3D } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import DxfParser from 'dxf-parser';
import initDjvu, { WasmDocument, wasmSimd128Supported } from 'djvu-rs';
import { localSamples } from '../tools/playground/catalog';
import { openPlayground } from '../tools/playground/files';
import type { Sample } from '../tools/playground/types';
import { Archives } from '../src/desktop/previews/archives';
import { extractDocument } from '../src/desktop/previews/formats';
import { temporaryRoot } from '../tools/temporary';

const require = createRequire(import.meta.url);
// jsdom is an existing test dependency without published types in this checkout.
// Describe only the three capabilities used by these decoder tests.
const { JSDOM } = require('jsdom') as {
  JSDOM: new () => {
    window: {
      DOMParser: typeof DOMParser;
      ProgressEvent: typeof ProgressEvent;
      close(): void;
    };
  };
};
const bytes = (sample: Sample) =>
  typeof sample.bytes === 'string' ? new TextEncoder().encode(sample.bytes) : sample.bytes;
const buffer = (sample: Sample) => new Uint8Array(bytes(sample)).buffer;
let samples: Sample[];
let directory: string;
const dom = new JSDOM();

beforeAll(async () => {
  samples = await localSamples();
  const root = await temporaryRoot('viewer-playground-assets-');
  const files = await openPlayground(path.join(root, 'samples'));
  directory = files.root;
  for (const sample of samples) await files.put(sample.path, sample.bytes);
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
  vi.stubGlobal('ProgressEvent', dom.window.ProgressEvent);
});
afterAll(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

const format = (extension: string) => {
  const sample = samples.find((sample) => sample.formats.includes(extension));
  if (!sample) throw new Error(`Missing sample for ${extension}`);
  return sample;
};
const meshes = (object: Object3D) => {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof Mesh) {
      expect(child.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(3);
      count += 1;
    }
  });
  return count;
};

describe('playground reference decoders', () => {
  it('extracts actual PDF pages, EPUB chapters, Word blocks and saved spreadsheet values', async () => {
    const read = (extension: string) =>
      extractDocument(path.join(directory, format(extension).path));
    const pdf = await read('pdf');
    expect(pdf.text).toContain('Aluminum');
    expect(pdf.text).toContain('Keep the evidence nearby');
    const epub = await read('epub');
    expect(epub.text).toContain('Look around');
    expect(epub.text).toContain('Keep context');
    const word = await read('docx');
    expect(word.office?.kind).toBe('word');
    expect(word.text).toContain('Aluminum, 3 mm');
    const spreadsheet = await read('xlsx');
    expect(spreadsheet.office?.kind).toBe('workbook');
    expect(spreadsheet.text).toContain('132');
    if (spreadsheet.office?.kind === 'workbook') {
      expect(spreadsheet.office.sheets.map((sheet) => sheet.name)).toEqual(['Materials', 'Notes']);
      expect(
        spreadsheet.office.sheets[0].rows
          .flatMap((row) => row.cells)
          .some((cell) => cell.formula === 'B2*C2'),
      ).toBe(true);
    }
  });

  it('reads nested entries from all four archive extensions', async () => {
    const archives = new Archives();
    for (const extension of ['zip', 'tar', 'tar.gz', 'tgz']) {
      const file = path.join(directory, format(extension).path);
      const listing = await archives.list(file);
      expect(listing.entries.map((entry) => entry.name)).toContain('data/materials.csv');
      expect(listing.truncated).toBe(false);
      archives.release(file);
    }
  });

  it('renders a nonblank DjVu page through the bundled decoder', async () => {
    const variant = wasmSimd128Supported() ? 'simd128' : 'scalar';
    const wasm = path.join(path.dirname(require.resolve('djvu-rs')), variant, 'djvu_rs_bg.wasm');
    await initDjvu(new Uint8Array(await readFile(wasm)));
    const document = WasmDocument.from_bytes(bytes(format('djvu')));
    try {
      expect(document.page_count()).toBe(1);
      const page = document.page(0);
      try {
        const pixels = page.render(96);
        expect(pixels.length).toBeGreaterThan(1000);
        expect(pixels.some((value, index) => index % 4 !== 3 && value < 100)).toBe(true);
      } finally {
        page.free();
      }
    } finally {
      document.free();
    }
  });

  it('loads mesh formats into nonempty geometry and preserves glTF companion data', async () => {
    expect(meshes(new OBJLoader().parse(String(format('obj').bytes)))).toBe(1);
    expect(meshes(new FBXLoader().parse(buffer(format('fbx')), ''))).toBe(1);
    expect(meshes(new ThreeMFLoader().parse(buffer(format('3mf'))))).toBe(1);
    expect(new PLYLoader().parse(buffer(format('ply'))).getAttribute('position').count).toBe(8);
    expect(new STLLoader().parse(buffer(format('stl'))).getAttribute('position').count).toBe(36);
    const glb = await new GLTFLoader().parseAsync(buffer(format('glb')), '');
    expect(meshes(glb.scene)).toBe(1);
    const gltf = JSON.parse(String(format('gltf').bytes));
    const companion = samples.find((sample) => sample.path.endsWith('/reference-block.bin'))!;
    gltf.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(bytes(companion)).toString('base64')}`;
    expect(meshes((await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')).scene)).toBe(1);
  });

  it('converts both CAD encodings and parses the millimeter drawing layers', async () => {
    const create = require('occt-import-js') as () => Promise<{
      ReadStepFile(
        bytes: Uint8Array,
        parameters: { linearUnit: string },
      ): { success: boolean; meshes: unknown[] };
      ReadIgesFile(
        bytes: Uint8Array,
        parameters: { linearUnit: string },
      ): { success: boolean; meshes: unknown[] };
    }>;
    const converter = await create();
    for (const extension of ['step', 'stp', 'iges', 'igs']) {
      const result =
        extension === 'step' || extension === 'stp'
          ? converter.ReadStepFile(bytes(format(extension)), { linearUnit: 'millimeter' })
          : converter.ReadIgesFile(bytes(format(extension)), { linearUnit: 'millimeter' });
      expect(result.success).toBe(true);
      expect(result.meshes.length).toBeGreaterThan(0);
    }
    const drawing = new DxfParser().parseSync(String(format('dxf').bytes));
    expect(drawing?.entities).toHaveLength(6);
    expect(new Set(drawing?.entities.map((entity) => entity.layer))).toEqual(
      new Set(['CUT', 'HOLES']),
    );
  });
});
