import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sample, zip } from './documents';
import type { Sample } from '../types';

const points = [
  [-50, -30, -20],
  [50, -30, -20],
  [50, 30, -20],
  [-50, 30, -20],
  [-50, -30, 20],
  [50, -30, 20],
  [50, 30, 20],
  [-50, 30, 20],
];
const faces = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [3, 7, 6],
  [3, 6, 2],
  [0, 4, 7],
  [0, 7, 3],
  [1, 2, 6],
  [1, 6, 5],
];

function gltfModel(): { json: Record<string, unknown>; positions: Buffer } {
  // glTF uses meters: this block is 100 × 60 × 40 millimeters.
  const positions = Buffer.alloc(faces.length * 9 * 4);
  faces
    .flatMap((face) => face.flatMap((index) => points[index]))
    .forEach((value, index) => positions.writeFloatLE(value / 1000, index * 4));
  return {
    positions,
    json: {
      asset: { version: '2.0', generator: 'Viewer Playground' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Reference block' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorFactor: [0.25, 0.6, 0.74, 1],
            metallicFactor: 0.25,
            roughnessFactor: 0.4,
          },
        },
      ],
      buffers: [{ uri: 'reference-block.bin', byteLength: positions.length }],
      bufferViews: [{ buffer: 0, byteLength: positions.length }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: faces.length * 3,
          type: 'VEC3',
          min: [-0.05, -0.03, -0.02],
          max: [0.05, 0.03, 0.02],
        },
      ],
    },
  };
}

function glb(json: Record<string, unknown>, positions: Buffer): Uint8Array {
  const text = Buffer.from(
    JSON.stringify({ ...json, buffers: [{ byteLength: positions.length }] }),
  );
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 32)]);
  const result = Buffer.alloc(28 + padded.length + positions.length);
  result.writeUInt32LE(0x46546c67);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  result.writeUInt32LE(positions.length, 20 + padded.length);
  result.writeUInt32LE(0x004e4942, 24 + padded.length);
  positions.copy(result, 28 + padded.length);
  return result;
}

export async function modelSamples(): Promise<Sample[]> {
  const { json, positions } = gltfModel();
  const obj = `mtllib Reference block.mtl
${points.map((point) => `v ${point.join(' ')}`).join('\n')}
usemtl ocean
${faces.map((face) => `f ${face.map((index) => index + 1).join(' ')}`).join('\n')}
`;
  const stl = `solid ReferenceBlock
${faces.map((face) => `facet normal 0 0 0\nouter loop\n${face.map((index) => `vertex ${points[index].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}
endsolid ReferenceBlock
`;
  const ply = `ply
format ascii 1.0
comment Viewer synthetic reference block
element vertex 8
property float x
property float y
property float z
element face 12
property list uchar int vertex_indices
end_header
${points.map((point) => point.join(' ')).join('\n')}
${faces.map((face) => `3 ${face.join(' ')}`).join('\n')}
`;
  const fbx = `; FBX 7.4.0 project file
FBXHeaderExtension: {
  FBXHeaderVersion: 1003
  FBXVersion: 7400
}
Objects: {
  Geometry: 1, "Geometry::ReferenceBlock", "Mesh" {
    Vertices: *24 {
      a: ${points.flat().join(',')}
    }
    PolygonVertexIndex: *36 {
      a: ${faces.flatMap(([a, b, c]) => [a, b, -c - 1]).join(',')}
    }
  }
  Model: 2, "Model::ReferenceBlock", "Mesh" {
    Version: 232
    Properties70: {
      P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
      P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
      P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
    }
    Shading: T
    Culling: "CullingOff"
  }
}
Connections: {
  C: "OO",1,2
  C: "OO",2,0
}
`.replace(/^( +)/gm, (indent) => '\t'.repeat(indent.length / 2));
  const threeMF = zip({
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default
    Extension="rels"
    ContentType="application/vnd.openxmlformats-package.relationships+xml"
  />
  <Default
    Extension="model"
    ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
  />
</Types>
`,
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Target="/3D/3dmodel.model"
    Id="model"
    Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"
  />
</Relationships>
`,
    '3D/3dmodel.model': `<model
  unit="millimeter"
  xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>${points.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices>
        <triangles>${faces.map(([v1, v2, v3]) => `<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`).join('')}</triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1" /></build>
</model>
`,
  });
  const result = [
    sample(
      'previews/models/Reference block.gltf',
      ['gltf'],
      'Interactive 3D model',
      'External binary buffer, physically based material; 100 × 60 × 40 mm.',
      JSON.stringify(json, null, 2) + '\n',
    ),
    sample(
      'previews/models/reference-block.bin',
      [],
      'Companion buffer',
      'Required by Reference block.gltf; not an independently supported preview format.',
      positions,
    ),
    sample(
      'previews/models/Reference block.glb',
      ['glb'],
      'Interactive 3D model',
      'Self-contained binary glTF reference block.',
      glb(json, positions),
    ),
    sample(
      'previews/models/Reference block.obj',
      ['obj'],
      'Interactive 3D model',
      'Wavefront mesh with a neighboring material file.',
      obj,
    ),
    sample(
      'previews/models/Reference block.mtl',
      [],
      'Companion material',
      'Ocean-colored Wavefront material.',
      'newmtl ocean\nKd 0.25 0.6 0.74\n',
    ),
    sample(
      'previews/models/Reference block.stl',
      ['stl'],
      'Interactive 3D model',
      'Twelve ASCII facets; unitless coordinates intended as millimeters.',
      stl,
    ),
    sample(
      'previews/models/Reference block.ply',
      ['ply'],
      'Interactive 3D model',
      'ASCII vertices and triangle faces.',
      ply,
    ),
    sample(
      'previews/models/Reference block.fbx',
      ['fbx'],
      'Interactive 3D model',
      'ASCII FBX mesh and hierarchy.',
      fbx,
    ),
    sample(
      'previews/models/Reference block.3mf',
      ['3mf'],
      'Interactive 3D model',
      'Millimeter geometry package; no slicer settings or printer commands.',
      threeMF,
    ),
  ];
  const require = createRequire(import.meta.url);
  const cadRoot = path.dirname(require.resolve('occt-import-js/package.json'));
  for (const [format, source] of [
    ['step', 'cube-units/cube-mm.step'],
    ['stp', 'cube-units/cube-mm.step'],
    ['iges', 'cube-10x10mm/Cube 10x10.igs'],
    ['igs', 'cube-10x10mm/Cube 10x10.igs'],
  ]) {
    result.push({
      ...sample(
        `previews/models/CAD cube.${format}`,
        [format],
        'Locally converted CAD geometry',
        'Real OpenCascade test solid, with declared units.',
        await readFile(path.join(cadRoot, 'test/testfiles', source)),
      ),
      source: `Installed occt-import-js test/testfiles/${source}; package version pinned by pnpm-lock.yaml.`,
      license: 'LGPL-2.1; see licenses/occt-import-js.txt and the package source.',
    });
  }
  result.push(
    sample(
      'licenses/occt-import-js.txt',
      [],
      'License text',
      'Unmodified license accompanying the reused CAD test solids.',
      await readFile(path.join(cadRoot, 'LICENSE.md')),
    ),
  );
  return result;
}
