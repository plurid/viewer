import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { zipSync } from 'fflate';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import type { FileEntry } from '../src/domain/contracts';
import { fileFamily } from '../src/domain/files/entries';
import { modelFormats, selfContainedModelFormats } from '../src/domain/previews/models/formats';
import { choosePreview } from '../src/renderer/previews/registry';
import { parseMesh } from '../src/renderer/previews/model/mesh-parser';
import { parseOFF } from '../src/renderer/previews/model/off';
import { parseX3D } from '../src/renderer/previews/model/x3d';
import {
  check3DS,
  checkUSDZ,
  colladaObjects,
  embeddedAssets,
  loadScene,
  sceneNotices,
  vrmlObjects,
  withoutMissingTextures,
} from '../src/renderer/previews/model/scenes';
import type { SceneFormat } from '../src/renderer/previews/model/scenes';
import { Resources } from '../src/desktop/previews/resources';
import { localSamples } from '../tools/playground/catalog';
import type { Sample } from '../tools/playground/types';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const require = createRequire(import.meta.url);
// jsdom is an existing test dependency without published types in this checkout.
const { JSDOM } = require('jsdom') as {
  JSDOM: new () => {
    window: { DOMParser: typeof DOMParser; document: Document; close(): void };
  };
};
const dom = new JSDOM();
let samples: Sample[];
beforeAll(async () => {
  samples = await localSamples();
  // Collada and X3D parse XML, and three's image loader makes an element per texture.
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
  vi.stubGlobal('document', dom.window.document);
});
afterAll(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

const sample = (extension: string) => {
  const found = samples.find((item) => item.formats.includes(extension));
  if (!found) throw new Error(`Missing sample for ${extension}`);
  return found;
};
const text = (extension: string) => String(sample(extension).bytes);
const bytes = (extension: string) => {
  const value = sample(extension).bytes;
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
};
const buffer = (extension: string) => new Uint8Array(bytes(extension)).buffer;
const signal = new AbortController().signal;
const load = (format: SceneFormat, body: BodyInit, size = 1000) =>
  loadScene(format, size, new Response(body), signal);

function geometry(object: THREE.Object3D) {
  let meshes = 0,
    vertices = 0,
    triangles = 0;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshes++;
    vertices += child.geometry.attributes.position.count;
    triangles += (child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3;
  });
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  return { meshes, vertices, triangles, size: size.toArray().map((value) => +value.toFixed(6)) };
}
const entry = (name: string) =>
  ({
    name,
    path: `/fixture/${name}`,
    extension: path.extname(name).slice(1),
    directory: false,
    mime: 'application/octet-stream',
  }) as FileEntry;

describe('additional 3D formats', () => {
  it('route to the model preview and stay out of the companion grant', () => {
    for (const extension of ['dae', '3ds', 'usdz', 'x3d', 'wrl', 'off']) {
      expect(choosePreview(entry(`Model.${extension}`)).id).toBe('model');
      expect(fileFamily(entry(`Model.${extension}`))).toBe('model');
      expect(selfContainedModelFormats).toContain(extension);
    }
    expect(modelFormats).toEqual(expect.arrayContaining(selfContainedModelFormats));
    expect(choosePreview(entry('Layer.usd')).id).toBe('fallback');
  });

  it('reads only a self-contained model file, never the files beside it', async () => {
    const root = await temporaryRoot('viewer-model-formats-');
    const resources = new Resources();
    try {
      await writeFile(path.join(root, 'texture.png'), 'not an image');
      for (const [name, expected] of [
        ['Scene.dae', 404],
        ['Scene.wrl', 404],
        ['Scene.obj', 200],
      ] as const) {
        await writeFile(path.join(root, name), 'model');
        const model = await resources.grant(path.join(root, name));
        const sibling = await resources.response(new Request(new URL('texture.png', model.url)));
        expect([name, sibling.status]).toEqual([name, expected]);
        expect((await resources.response(new Request(model.url))).status).toBe(200);
      }
    } finally {
      await resources.quiesce();
      await trashTemporary(root);
    }
  });

  it('loads what a file embeds and refuses every file it names', () => {
    const assets = embeddedAssets();
    const embedded = 'data:image/png;base64,iVBORw0KGgo=';
    expect(assets.manager.resolveURL(embedded)).toBe(embedded);
    expect(assets.manager.resolveURL('blob:viewer/1')).toBe('blob:viewer/1');
    for (const url of [
      'textures/Wood%20grain.png',
      'https://example.com/sky.jpg?size=2',
      'file:///Volumes/Shared/stone.tga',
      'C:\\Textures\\brick.bmp',
    ])
      expect(assets.manager.resolveURL(url)).toBe('data:,');
    expect([...assets.refused]).toEqual(['Wood grain.png', 'sky.jpg', 'stone.tga', 'brick.bmp']);
    // A refused texture never receives an image; a decoded one is kept.
    const missing = new THREE.Texture();
    const decoded = new THREE.Texture();
    decoded.needsUpdate = true;
    const material = new THREE.MeshPhongMaterial({ map: missing, normalMap: decoded });
    withoutMissingTextures(new THREE.Mesh(new THREE.BufferGeometry(), material));
    expect(material.map).toBe(null);
    expect(material.normalMap).toBe(decoded);
    expect(
      sceneNotices({
        object: new THREE.Group(),
        clips: [],
        references: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        skipped: ['Box'],
      }),
    ).toEqual([
      'Files this model links to are not loaded: a, b, c, d, e, f and 2 more',
      'Not drawn in this preview: Box',
    ]);
  });

  it('parses OFF vertices, polygons and colors within the mesh limits', () => {
    const block = parseOFF(text('off'));
    expect(block.attributes.position.count).toBe(8);
    expect(block.index?.count).toBe(36);
    block.computeBoundingBox();
    expect(block.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual([100, 60, 40]);
    // Counts on the header line, vertex colors as 0 to 255, comments and blank lines.
    const colored = parseOFF(
      'COFF 3 1 0\n0 0 0 255 0 0 255\n\n1 0 0 0 255 0 255 # green\n0 1 0 0 0 255 255\n3 0 1 2\n',
    );
    expect(Array.from(colored.attributes.color.array).map((value) => +value.toFixed(3))).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);
    // Face colors belong to corners, so the triangles get their own vertices.
    const faces = parseOFF(
      'OFF\n4 2 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n3 0 1 2 1 0 0\n3 0 2 3 0 0 1\n',
    );
    expect(faces.index).toBe(null);
    expect(faces.attributes.position.count).toBe(6);
    expect(Array.from(faces.attributes.color.array.slice(15))).toEqual([0, 0, 1]);
    // An edge or a point has no surface.
    expect(parseOFF('OFF\n3 2 0\n0 0 0\n1 0 0\n0 1 0\n2 0 1\n3 0 1 2\n').index?.count).toBe(3);
    const result = parseMesh(text('off'), 'off');
    expect(result.meshes).toHaveLength(1);
    expect(result.meshes[0]!.materials[0]!.vertexColors).toBe(false);
  });

  it('refuses malformed, oversized and unsupported OFF files before allocating', () => {
    expect(() => parseOFF('OFF\n4000001 1 0\n')).toThrow('geometry limit');
    expect(() => parseOFF('OFF\n3 2000001 0\n')).toThrow('geometry limit');
    expect(() => parseOFF('OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 3\n')).toThrow('indices');
    expect(() => parseOFF('OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n')).toThrow('ends before');
    expect(() => parseOFF('OFF\n3 1 0\n0 0 0\n1 x 0\n0 1 0\n3 0 1 2\n')).toThrow('line 4');
    expect(() => parseOFF('OFF BINARY\n')).toThrow('Binary');
    expect(() => parseOFF('4OFF\n1 0 0\n0 0 0 1\n')).toThrow('three-dimensional');
    expect(() => parseOFF('PLY\n')).toThrow('OFF header');
  });

  it('draws the X3D IndexedFaceSet subset with transforms, reuse and colors', () => {
    const block = parseX3D(text('x3d'));
    expect(geometry(block.object)).toEqual({
      meshes: 1,
      vertices: 8,
      triangles: 12,
      size: [100, 60, 40],
    });
    expect(block.references).toEqual([]);
    const scene = parseX3D(`<X3D><Scene>
      <Transform translation="10 0 0" rotation="0 0 1 1.5707963" scale="2 2 2">
        <Shape DEF="Tri">
          <Appearance><ImageTexture url='"maps/wood.png" "https://example.com/wood.png"'/></Appearance>
          <IndexedTriangleSet index="0 1 2" solid="false">
            <Coordinate point="0 0 0, 1 0 0, 0 1 0"/>
            <Color color="1 0 0, 0 1 0, 0 0 1"/>
          </IndexedTriangleSet>
        </Shape>
      </Transform>
      <Shape USE="Tri"/>
      <Switch whichChoice="1"><Shape USE="Tri"/><Transform translation="0 0 5"><Shape USE="Tri"/></Transform></Switch>
      <Shape><Box size="1 1 1"/></Shape>
      <Inline url='"world.x3d"'/>
    </Scene></X3D>`);
    expect(scene.references).toEqual(['wood.png', 'world.x3d']);
    expect(scene.skipped).toEqual(['Box']);
    expect(geometry(scene.object)).toMatchObject({ meshes: 3, vertices: 9 });
    const meshes: THREE.Mesh[] = [];
    scene.object.updateMatrixWorld(true);
    scene.object.traverse((child) => child instanceof THREE.Mesh && meshes.push(child));
    // Rotated a quarter turn about Z and doubled, then moved 10 along X.
    const corner = new THREE.Vector3(1, 0, 0).applyMatrix4(meshes[0]!.matrixWorld);
    expect(corner.toArray().map((value) => +value.toFixed(4))).toEqual([10, 2, 0]);
    expect(new THREE.Vector3(1, 0, 0).applyMatrix4(meshes[2]!.matrixWorld).z).toBe(5);
    const material = meshes[0]!.material as THREE.MeshPhongMaterial;
    expect([material.vertexColors, material.side]).toEqual([true, THREE.DoubleSide]);
  });

  it('refuses X3D entities, bad indices, deep nesting and runaway reuse', () => {
    expect(() => parseX3D('<!DOCTYPE X3D [<!ENTITY a "b">]><X3D><Scene/></X3D>')).toThrow(
      'entities',
    );
    expect(() => parseX3D('<Collada/>')).toThrow('not a valid X3D');
    expect(() =>
      parseX3D(
        '<X3D><Scene><Shape><IndexedFaceSet coordIndex="0 1 3 -1"><Coordinate point="0 0 0 1 0 0 0 1 0"/></IndexedFaceSet></Shape></Scene></X3D>',
      ),
    ).toThrow('indices');
    const deep = '<Group>'.repeat(300) + '</Group>'.repeat(300);
    expect(() => parseX3D(`<X3D><Scene>${deep}</Scene></X3D>`)).toThrow('nested too deeply');
    // Each level reuses the one below ten times: 10^6 copies from a few hundred bytes.
    let levels =
      '<Group DEF="L0"><Shape><IndexedFaceSet coordIndex="0 1 2"><Coordinate point="0 0 0 1 0 0 0 1 0"/></IndexedFaceSet></Shape></Group>';
    for (let level = 1; level <= 6; level++)
      levels += `<Group DEF="L${level}">${`<Group USE="L${level - 1}"/>`.repeat(10)}</Group>`;
    expect(() => parseX3D(`<X3D><Scene>${levels}</Scene></X3D>`)).toThrow('geometry limit');
  });

  it('loads the Collada block and refuses instancing that would not end', async () => {
    expect(colladaObjects(text('dae'))).toBe(2);
    const block = await load('dae', text('dae'));
    // Declared in millimeters; the loader normalizes Collada to meters.
    expect(geometry(block.object)).toEqual({
      meshes: 1,
      vertices: 36,
      triangles: 12,
      size: [0.1, 0.06, 0.04],
    });
    const library = (nodes: string) => `<COLLADA><library_nodes>${nodes}</library_nodes>
      <library_visual_scenes><visual_scene id="s"><node><instance_node url="#n6"/></node></visual_scene></library_visual_scenes></COLLADA>`;
    let nodes = '<node id="n0"><instance_geometry url="#g"/></node>';
    for (let level = 1; level <= 6; level++)
      nodes += `<node id="n${level}">${`<instance_node url="#n${level - 1}"/>`.repeat(10)}</node>`;
    expect(colladaObjects(library(nodes))).toBeGreaterThan(100000);
    await expect(load('dae', library(nodes))).rejects.toThrow('geometry limit');
    expect(() =>
      colladaObjects(
        library('<node id="n6"><node id="inner"><instance_node url="#n6"/></node></node>'),
      ),
    ).toThrow('inside itself');
    // A commented-out node is not part of the scene.
    expect(colladaObjects(library('<!-- <node id="n6"> --><node id="n6"/>'))).toBe(2);
    await expect(load('dae', '<!DOCTYPE c [<!ENTITY x "y">]><COLLADA/>')).rejects.toThrow(
      'entities',
    );
    // A texture in a separate file is named, never fetched.
    const assets = embeddedAssets();
    const textured = text('dae')
      .replace(
        '<library_effects>',
        '<library_images><image id="wood"><init_from>maps/wood.png</init_from></image></library_images><library_effects>',
      )
      .replace(
        '<profile_COMMON>',
        '<profile_COMMON><newparam sid="surface"><surface type="2D"><init_from>wood</init_from></surface></newparam><newparam sid="sampler"><sampler2D><source>surface</source></sampler2D></newparam>',
      )
      .replace(
        '<diffuse><color sid="diffuse">0.25 0.6 0.74 1</color></diffuse>',
        '<diffuse><texture texture="sampler" texcoord="uv"/></diffuse>',
      );
    new ColladaLoader(assets.manager).parse(textured, '');
    expect([...assets.refused]).toEqual(['wood.png']);
  });

  it('loads the 3DS block and refuses a chunk list the loader would never finish', async () => {
    check3DS(buffer('3ds'));
    const block = await load('3ds', buffer('3ds'));
    expect(geometry(block.object)).toEqual({
      meshes: 1,
      vertices: 8,
      triangles: 12,
      size: [100, 60, 40],
    });
    const mesh = block.object.children[0] as THREE.Mesh;
    expect(mesh.name).toBe('Reference block');
    expect((mesh.material as THREE.MeshPhongMaterial).name).toBe('ocean');
    // A zero-size chunk inside the mesh data: TDSLoader would read it forever.
    const stuck = new Uint8Array(bytes('3ds'));
    const view = new DataView(stuck.buffer);
    const data = 6 + 10;
    expect(view.getUint16(data, true)).toBe(0x3d3d);
    view.setUint32(data + 6 + 2, 0, true);
    expect(() => check3DS(stuck.buffer)).toThrow('malformed chunk');
    expect(() => check3DS(new Uint8Array([1, 2, 3, 4, 5, 6, 7]).buffer)).toThrow('not a 3DS');
  });

  it('loads a single-layer USDZ package and refuses packages it cannot bound', async () => {
    const usdz = bytes('usdz');
    const local = new DataView(usdz.buffer, usdz.byteOffset);
    // Stored, and the layer's data starts on a 64-byte boundary.
    expect(local.getUint16(8, true)).toBe(0);
    expect((30 + local.getUint16(26, true) + local.getUint16(28, true)) % 64).toBe(0);
    const block = await load('usdz', buffer('usdz'));
    expect(geometry(block.object)).toMatchObject({
      meshes: 1,
      triangles: 12,
      size: [0.1, 0.06, 0.04],
    });
    const layer = new TextEncoder().encode('#usda 1.0\n');
    expect(() => checkUSDZ(zipSync({ 'a.usda': layer, 'b.usdc': layer }))).toThrow('more than one');
    expect(() => checkUSDZ(zipSync({ 'texture.png': layer }))).toThrow('no USD layer');
    expect(() => checkUSDZ(layer)).toThrow('not a package');
    // A declared size past the limit is refused before anything expands.
    const inflated = zipSync({ 'a.usda': layer });
    const view = new DataView(inflated.buffer);
    let central = inflated.length - 4;
    while (view.getUint32(central, true) !== 0x02014b50) central--;
    view.setUint32(central + 24, 65 * 1024 * 1024, true);
    expect(() => checkUSDZ(inflated)).toThrow('preview limit');
  });

  it('loads VRML worlds without their backgrounds or the files they name', async () => {
    expect(vrmlObjects(text('wrl'))).toBeLessThan(10);
    const assets = embeddedAssets();
    const world = new VRMLLoader(assets.manager).parse(text('wrl'), '');
    expect([...assets.refused]).toEqual(['Reference block texture.png']);
    expect(geometry(world)).toMatchObject({ meshes: 1, triangles: 12, size: [100, 60, 40] });
    const background = await load(
      'wrl',
      '#VRML V2.0 utf8\nBackground { skyColor [0 0 1] }\nShape { geometry Box { size 2 4 6 } }\n',
    );
    expect(geometry(background.object)).toMatchObject({ meshes: 1, size: [2, 4, 6] });
    // Each level reuses the one below ten times.
    let levels = 'DEF L0 Shape { geometry Box {} }\n';
    for (let level = 1; level <= 6; level++)
      levels += `DEF L${level} Group { children [ ${`USE L${level - 1} `.repeat(10)}] }\n`;
    expect(vrmlObjects(levels)).toBeGreaterThan(100000);
    await expect(load('wrl', `#VRML V2.0 utf8\n${levels}`)).rejects.toThrow('geometry limit');
    expect(() => vrmlObjects('DEF A Group { children [ USE A ] }')).toThrow('inside itself');
    // A USE at the top of the file is a copy too.
    expect(vrmlObjects(`${levels.replace(/\n$/, '')} USE L6 USE L6`)).toBeGreaterThan(100000);
    expect(vrmlObjects('DEF A Shape {} USE A USE A')).toBe(3);
    // Braces in strings and comments are not nodes.
    expect(vrmlObjects('WorldInfo { info [ "{ {" ] } # {\n')).toBe(1);
    await expect(load('wrl', '#VRML V1.0 ascii\nSeparator {}\n')).rejects.toThrow('VRML 2.0');
  });

  it('checks each format’s file limit before reading the file', async () => {
    for (const [format, limit] of [
      ['dae', 64],
      ['3ds', 128],
      ['usdz', 128],
      ['wrl', 16],
      ['x3d', 64],
    ] as const) {
      const response = new Response('unread');
      await expect(loadScene(format, limit * 1_000_000 + 1, response, signal)).rejects.toThrow(
        `${limit} MB preview limit`,
      );
      expect(response.bodyUsed).toBe(false);
    }
  });
});
