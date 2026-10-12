import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cadMeshes, type ImportedCad } from '../src/renderer/previews/model/cad-data';
import { cadMaterial } from '../src/renderer/previews/model/appearance';

const require = createRequire(import.meta.url);
describe('local CAD geometry conversion', () => {
  it('tessellates a real STEP solid into indexed millimeter geometry', async () => {
    const create = require('occt-import-js') as () => Promise<{
      ReadStepFile(data: Uint8Array, params: { linearUnit: string }): ImportedCad;
    }>;
    const occt = await create();
    const fixture = path.join(
      path.dirname(require.resolve('occt-import-js/package.json')),
      'test/testfiles/simple-basic-cube/cube.stp',
    );
    const meshes = cadMeshes(
      occt.ReadStepFile(new Uint8Array(await readFile(fixture)), { linearUnit: 'millimeter' }),
    );
    expect(meshes).toHaveLength(1);
    expect(meshes[0].indices.length).toBeGreaterThanOrEqual(36);
    const positions = [...meshes[0].positions];
    const dimensions = [0, 1, 2].map((axis) => {
      const coordinates = positions.filter((_, index) => index % 3 === axis);
      return Math.max(...coordinates) - Math.min(...coordinates);
    });
    for (const dimension of dimensions) expect(dimension).toBeCloseTo(300, 6);
  });
  it('rejects failed imports and invalid converter geometry before GPU upload', () => {
    expect(() => cadMeshes({ success: false, meshes: [] })).toThrow('No geometry');
    const triangle: ImportedCad = {
      success: true,
      meshes: [
        {
          name: 'test',
          attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } },
          index: { array: [0, 1, 2] },
        },
      ],
    };
    expect(cadMeshes(triangle)[0].positions).toBeInstanceOf(Float32Array);
    triangle.meshes[0].index.array[2] = 20;
    expect(() => cadMeshes(triangle)).toThrow('invalid geometry');
    triangle.meshes[0].index.array[2] = 2;
    triangle.meshes[0].attributes.position.array[0] = Infinity;
    expect(() => cadMeshes(triangle)).toThrow('invalid geometry');
  });
  it('retains the original STEP color when assigning imported linear values to a material', async () => {
    const create = require('occt-import-js') as () => Promise<{
      ReadStepFile(data: Uint8Array, params: { linearUnit: string }): ImportedCad;
    }>;
    const occt = await create();
    const fixture = path.join(
      path.dirname(require.resolve('occt-import-js/package.json')),
      'test/testfiles/simple-basic-cube/cube.stp',
    );
    // The original STEP names Orange with sRGB components (1, 0.6, 0).
    const meshes = cadMeshes(
      occt.ReadStepFile(new Uint8Array(await readFile(fixture)), { linearUnit: 'millimeter' }),
    );
    const material = cadMaterial(meshes[0].color);
    try {
      expect(material.color.getHexString()).toBe('ff9900');
    } finally {
      material.dispose();
    }
  });
});
