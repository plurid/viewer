import createOcct from 'occt-import-js';
import wasmURL from 'occt-import-js/dist/occt-import-js.wasm?url';
import { cadMeshes, type CadReply } from './cad-data';
import { errorMessage } from '../../../domain/errors';

// The worker is disposable: conversion, its WASM heap and source bytes leave together.
self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; extension: string }>) => {
  try {
    const response = await fetch(wasmURL);
    if (!response.ok) throw new Error('The CAD preview engine is unavailable.');
    const occt = await createOcct({ wasmBinary: await response.arrayBuffer() });
    const params = {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.001,
      angularDeflection: 0.5,
    };
    const data = new Uint8Array(event.data.buffer);
    const result = ['iges', 'igs'].includes(event.data.extension)
      ? occt.ReadIgesFile(data, params)
      : occt.ReadStepFile(data, params);
    const meshes = cadMeshes(result);
    self.postMessage({ meshes } satisfies CadReply, {
      transfer: meshes.flatMap((mesh) => [
        mesh.positions.buffer,
        mesh.indices.buffer,
        ...(mesh.normals ? [mesh.normals.buffer] : []),
      ]),
    });
  } catch (error) {
    self.postMessage({
      error: errorMessage(error) || 'This CAD file could not be read.',
    } satisfies CadReply);
  }
};
