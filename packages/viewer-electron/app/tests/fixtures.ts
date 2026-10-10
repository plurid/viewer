import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import type { SavedState } from '../src/domain/contracts';
import { audioFixture, imageFixture, videoFixture } from './media-fixtures';

function pdf(): Buffer {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream =
    'BT /F1 24 Tf 64 700 Td (Viewer preview fixture) Tj /F1 12 Tf 0 -32 Td (Searchable PDF text and local file resources.) Tj ET';
  bodies.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let document = '%PDF-1.4\n';
  const offsets = [0];
  bodies.forEach((body, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document);
}
function tar(): Buffer {
  const data = Buffer.from('# Archive note\n\nAn entry preview without extraction.\n');
  const header = Buffer.alloc(512);
  header.write('notes.md');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const sum = header.reduce((value, byte) => value + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, data, Buffer.alloc(512 - data.length), Buffer.alloc(1024)]);
}
export async function createFixtures(): Promise<{
  root: string;
  files: string;
  state: SavedState;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-verification-'));
  const files = path.join(root, 'Studio');
  for (const name of ['Models', 'Documents', 'Images', 'Media', 'Data', 'Source', 'Transfers'])
    await mkdir(path.join(files, name), { recursive: true });
  const model = path.join(files, 'Models');
  const vertices = Buffer.from(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]).buffer);
  const gltf = {
    asset: { version: '2.0', generator: 'Viewer synthetic test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.32, 0.65, 0.82, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.5,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ uri: 'triangle.bin', byteLength: vertices.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices.length }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-1, -1, 0],
        max: [1, 1, 0],
      },
    ],
  };
  await writeFile(path.join(model, 'triangle.bin'), vertices);
  await writeFile(path.join(model, 'Triangle.gltf'), JSON.stringify(gltf));
  const embedded = { ...gltf, buffers: [{ byteLength: vertices.length }] };
  let json = Buffer.from(JSON.stringify(embedded));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const glb = Buffer.alloc(12 + 8 + json.length + 8 + vertices.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  glb.writeUInt32LE(vertices.length, 20 + json.length);
  glb.writeUInt32LE(0x004e4942, 24 + json.length);
  vertices.copy(glb, 28 + json.length);
  await writeFile(path.join(model, 'Triangle.glb'), glb);
  await symlink('Triangle.glb', path.join(model, 'Triangle alias.glb'));
  await writeFile(
    path.join(model, 'Triangle.obj'),
    'mtllib Triangle.mtl\nv -1 -1 0\nv 1 -1 0\nv 0 1 0\nusemtl blue\nf 1 2 3\n',
  );
  await writeFile(path.join(model, 'Triangle.mtl'), 'newmtl blue\nKd 0.32 0.65 0.82\n');
  await writeFile(
    path.join(model, 'Triangle.stl'),
    'solid Triangle\nfacet normal 0 0 1\nouter loop\nvertex -1 -1 0\nvertex 1 -1 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid Triangle\n',
  );
  const fbx = `; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n\tFBXHeaderVersion: 1003\n\tFBXVersion: 7400\n}\nObjects:  {\n\tGeometry: 1, "Geometry::Triangle", "Mesh" {\n\t\tVertices: *9 {\n\t\t\ta: -1,-1,0,1,-1,0,0,1,0\n\t\t}\n\t\tPolygonVertexIndex: *3 {\n\t\t\ta: 0,1,-3\n\t\t}\n\t}\n\tModel: 2, "Model::Triangle", "Mesh" {\n\t\tVersion: 232\n\t\tProperties70:  {\n\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0\n\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0\n\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1\n\t\t}\n\t\tShading: T\n\t\tCulling: "CullingOff"\n\t}\n}\nConnections:  {\n\tC: "OO",1,2\n\tC: "OO",2,0\n}\n`;
  await writeFile(path.join(model, 'Triangle.fbx'), fbx);
  await writeFile(path.join(model, 'Malformed.glb'), Buffer.from('broken'));
  await writeFile(
    path.join(model, 'Missing-assets.gltf'),
    JSON.stringify({ ...gltf, buffers: [{ uri: 'missing.bin', byteLength: vertices.length }] }),
  );
  await writeFile(
    path.join(files, 'Documents', 'Project notes.md'),
    '# A wider view\n\nViewer keeps folders and previews together in one workspace.\n\n## This week\n\n- Compare the model variants\n- Organize the reference files\n- Share the final archive\n\n```typescript\nconst workspace = { name: "Studio", previews: true };\n```\n',
  );
  await writeFile(path.join(files, 'Documents', 'Project brief.pdf'), pdf());
  await writeFile(
    path.join(files, 'Data', 'Materials.json'),
    JSON.stringify(
      {
        project: 'Studio',
        materials: [
          { name: 'Brushed aluminum', roughness: 0.4 },
          { name: 'Soft polymer', roughness: 0.8 },
        ],
        previewOnly: true,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(files, 'Data', 'Inventory.csv'),
    'Name,Quantity,Size\nTriangle,3,"Small, medium"\nTexture,12,Large\n',
  );
  await writeFile(path.join(files, 'Data', 'Malformed.json'), '{broken');
  await writeFile(
    path.join(files, 'Source', 'workspace.ts'),
    'export interface Workspace {\n  id: string;\n  name: string;\n  files: string[];\n}\n\nexport const studio: Workspace = { id: "studio", name: "Studio", files: [] };\n',
  );
  await writeFile(
    path.join(files, 'Images', 'Reference.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#31353d"/><path d="M220 440 400 140 580 440Z" fill="#82b3cf"/><text x="400" y="520" fill="#f2f4f6" font-family="sans-serif" font-size="24" text-anchor="middle">Synthetic preview fixture</text></svg>',
  );
  await writeFile(path.join(files, 'Images', 'Color.png'), imageFixture);
  await writeFile(path.join(files, 'Media', 'Tone.wav'), audioFixture());
  await writeFile(path.join(files, 'Media', 'Color.webm'), videoFixture);
  await writeFile(
    path.join(files, 'Reference files.zip'),
    zipSync({
      'notes.md': strToU8('# Local archive preview'),
      'inventory.csv': strToU8('name,count\nmodels,5'),
    }),
  );
  await writeFile(path.join(files, 'Reference files.tar'), tar());
  await writeFile(path.join(files, 'Reference files.tar.gz'), gzipSync(tar()));
  await writeFile(path.join(files, '.hidden-fixture'), 'Hidden file');
  await writeFile(
    path.join(files, 'README.md'),
    '# Studio\n\nSynthetic files for local Viewer verification.\n',
  );
  const folder = {
    id: 'fixture-folder',
    type: 'folder' as const,
    path: files,
    mode: 'list' as const,
    sort: 'name' as const,
    descending: false,
    showHidden: false,
    history: [files],
    historyIndex: 0,
  };
  const state: SavedState = {
    version: 1,
    workspaces: [
      {
        id: 'fixture-workspace',
        name: 'Studio',
        panes: [folder],
        roots: [folder.id],
        arrangement: {},
      },
    ],
    activeWorkspace: 'fixture-workspace',
    favorites: [
      { name: 'Models', path: model },
      { name: 'Documents', path: path.join(files, 'Documents') },
    ],
    recents: [],
    look: 'dark',
  };
  return { root, files, state };
}
