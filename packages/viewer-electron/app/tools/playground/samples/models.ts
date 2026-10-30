import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
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

// The same block as six quadrilaterals, for formats that keep polygons.
const quads = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 4, 7, 3],
  [1, 2, 6, 5],
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

function collada(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>Viewer Playground</authoring_tool></contributor>
    <unit name="millimeter" meter="0.001"/>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_effects>
    <effect id="ocean-effect">
      <profile_COMMON>
        <technique sid="common">
          <phong>
            <diffuse><color sid="diffuse">0.25 0.6 0.74 1</color></diffuse>
            <specular><color sid="specular">0.2 0.2 0.2 1</color></specular>
            <shininess><float sid="shininess">20</float></shininess>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>
  </library_effects>
  <library_materials>
    <material id="ocean" name="ocean"><instance_effect url="#ocean-effect"/></material>
  </library_materials>
  <library_geometries>
    <geometry id="block" name="Reference block">
      <mesh>
        <source id="block-positions">
          <float_array id="block-positions-array" count="${points.length * 3}">${points.flat().join(' ')}</float_array>
          <technique_common>
            <accessor source="#block-positions-array" count="${points.length}" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="block-vertices">
          <input semantic="POSITION" source="#block-positions"/>
        </vertices>
        <triangles material="ocean" count="${faces.length}">
          <input semantic="VERTEX" source="#block-vertices" offset="0"/>
          <p>${faces.flat().join(' ')}</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene">
      <node id="block-node" name="Reference block">
        <instance_geometry url="#block">
          <bind_material>
            <technique_common>
              <instance_material symbol="ocean" target="#ocean"/>
            </technique_common>
          </bind_material>
        </instance_geometry>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}

/** A 3DS chunk: its ID, its size including this six-byte header, then its contents. */
function chunk(id: number, ...contents: Buffer[]): Buffer {
  const header = Buffer.alloc(6);
  const body = Buffer.concat(contents);
  header.writeUInt16LE(id);
  header.writeUInt32LE(header.length + body.length, 2);
  return Buffer.concat([header, body]);
}
function littleEndian(size: 2 | 4, values: number[], float = false): Buffer {
  const result = Buffer.alloc(values.length * size);
  values.forEach((value, index) => {
    if (float) result.writeFloatLE(value, index * size);
    else if (size === 2) result.writeUInt16LE(value, index * size);
    else result.writeUInt32LE(value, index * size);
  });
  return result;
}
const cString = (text: string) => Buffer.from(text + '\0', 'latin1');

function threeDS(): Buffer {
  return chunk(
    0x4d4d,
    chunk(0x0002, littleEndian(4, [3])),
    chunk(
      0x3d3d,
      chunk(0x3d3e, littleEndian(4, [3])),
      chunk(
        0xafff,
        chunk(0xa000, cString('ocean')),
        chunk(0xa020, chunk(0x0011, Buffer.from([64, 153, 189]))),
      ),
      chunk(
        0x4000,
        cString('Reference block'),
        chunk(
          0x4100,
          chunk(0x4110, littleEndian(2, [points.length]), littleEndian(4, points.flat(), true)),
          chunk(
            0x4120,
            littleEndian(2, [faces.length]),
            littleEndian(
              2,
              faces.flatMap((face) => [...face, 0]),
            ),
            chunk(
              0x4130,
              cString('ocean'),
              littleEndian(2, [faces.length]),
              littleEndian(
                2,
                faces.map((_, index) => index),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function usdz(): Uint8Array {
  const name = 'Reference block.usda';
  const layer = `#usda 1.0
(
    defaultPrim = "ReferenceBlock"
    metersPerUnit = 0.001
    upAxis = "Y"
)

def Xform "ReferenceBlock"
{
    def Mesh "Block"
    {
        int[] faceVertexCounts = [${quads.map((quad) => quad.length).join(', ')}]
        int[] faceVertexIndices = [${quads.flat().join(', ')}]
        point3f[] points = [${points.map((point) => `(${point.join(', ')})`).join(', ')}]
        color3f[] primvars:displayColor = [(0.25, 0.6, 0.74)]
        uniform token subdivisionScheme = "none"
    }
}
`;
  // USDZ stores its files uncompressed, each starting at a multiple of 64 bytes; as Pixar's
  // usdzip does, an extra field (ID 0x1986) pads the local header to the boundary.
  const header = 30 + Buffer.byteLength(name) + 4;
  return zipSync(
    {
      [name]: [
        new TextEncoder().encode(layer),
        { level: 0, extra: { 0x1986: new Uint8Array((64 - (header % 64)) % 64) } },
      ],
    },
    { mtime: new Date('2026-01-01T00:00:00Z') },
  );
}

function vrml(): string {
  return `#VRML V2.0 utf8
# Viewer synthetic reference block. The texture is a separate file, which Viewer does not read.
WorldInfo { title "Reference block" }
DEF ReferenceBlock Transform {
  children [
    Shape {
      appearance Appearance {
        material Material { diffuseColor 0.25 0.6 0.74 }
        texture ImageTexture { url "Reference block texture.png" }
      }
      geometry IndexedFaceSet {
        coord Coordinate {
          point [ ${points.map((point) => point.join(' ')).join(', ')} ]
        }
        coordIndex [ ${quads.map((quad) => `${quad.join(' ')} -1`).join(', ')} ]
      }
    }
  ]
}
`;
}

function x3d(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 3.3//EN" "https://www.web3d.org/specifications/x3d-3.3.dtd">
<X3D profile="Interchange" version="3.3">
  <head>
    <meta name="title" content="Reference block"/>
    <meta name="generator" content="Viewer Playground"/>
  </head>
  <Scene>
    <Transform DEF="ReferenceBlock">
      <Shape>
        <Appearance>
          <Material DEF="Ocean" diffuseColor="0.25 0.6 0.74"/>
        </Appearance>
        <IndexedFaceSet coordIndex="${quads.map((quad) => `${quad.join(' ')} -1`).join(' ')}">
          <Coordinate point="${points.map((point) => point.join(' ')).join(', ')}"/>
        </IndexedFaceSet>
      </Shape>
    </Transform>
  </Scene>
</X3D>
`;
}

function off(): string {
  return `OFF
# Viewer synthetic reference block
${points.length} ${quads.length} 12
${points.map((point) => point.join(' ')).join('\n')}
${quads.map((quad) => `${quad.length} ${quad.join(' ')}`).join('\n')}
`;
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
    sample(
      'previews/models/Reference block.dae',
      ['dae'],
      'Interactive 3D model',
      'Collada 1.4.1 mesh with a phong material, declared in millimeters.',
      collada(),
    ),
    sample(
      'previews/models/Reference block.3ds',
      ['3ds'],
      'Interactive 3D model',
      'Binary 3DS mesh with a named material; Z axis up.',
      threeDS(),
    ),
    sample(
      'previews/models/Reference block.usdz',
      ['usdz'],
      'Interactive 3D model',
      'Single-layer USDZ package holding a text USD mesh, declared in millimeters.',
      usdz(),
    ),
    sample(
      'previews/models/Reference block.wrl',
      ['wrl'],
      'Interactive 3D model; the texture it names is listed as not loaded',
      'VRML97 world whose ImageTexture names a separate file, which is not supplied.',
      vrml(),
    ),
    sample(
      'previews/models/Reference block.x3d',
      ['x3d'],
      'Interactive 3D model',
      'X3D 3.3 XML scene with an IndexedFaceSet of six faces.',
      x3d(),
    ),
    sample(
      'previews/models/Reference block.off',
      ['off'],
      'Interactive 3D model',
      'Geomview OFF mesh of six quadrilateral faces.',
      off(),
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
