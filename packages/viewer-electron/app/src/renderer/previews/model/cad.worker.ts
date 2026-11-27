import { readerProblemFields } from '../../../domain/previews/reader-problem';
import createOcct from 'occt-import-js';
import wasmURL from 'occt-import-js/dist/occt-import-js.wasm?url';
import { cadMeshes } from './cad-data';
import type { CadRequest, CadResponse } from './cad-data';
import { errorMessage } from '../../../domain/errors';

type Occt = Awaited<ReturnType<typeof createOcct>>;

let engine: Promise<Occt> | undefined;

/** OCCT from the window's compiled module, skipping the compile a new worker would repeat. */
function instantiated(module: WebAssembly.Module): Promise<Occt> {
  return new Promise((resolve, reject) => {
    createOcct({
      instantiateWasm(imports, receive) {
        WebAssembly.instantiate(module, imports).then(
          (instance) => receive(instance, module),
          reject,
        );
        return {};
      },
    }).then(resolve, reject);
  });
}

async function compiled(): Promise<Occt> {
  const response = await fetch(wasmURL);
  if (!response.ok) throw new Error("The CAD converter couldn't load. Try again.");
  return createOcct({ wasmBinary: await response.arrayBuffer() });
}

function occtEngine(module?: WebAssembly.Module): Promise<Occt> {
  return (engine ??= (module ? instantiated(module).catch(() => compiled()) : compiled()).catch(
    (error: unknown) => {
      engine = undefined;
      throw error;
    },
  ));
}

self.onmessage = async (event: MessageEvent<CadRequest>) => {
  const { id, buffer, extension, module } = event.data;
  let occt: Occt | undefined;
  try {
    occt = await occtEngine(module);
    const params = {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.001,
      angularDeflection: 0.5,
    };
    const data = new Uint8Array(buffer);
    const result = ['iges', 'igs'].includes(extension)
      ? occt.ReadIgesFile(data, params)
      : occt.ReadStepFile(data, params);
    const meshes = cadMeshes(result);
    self.postMessage({ id, meshes, heap: occt.HEAP8.length } satisfies CadResponse, {
      transfer: meshes.flatMap((mesh) => [
        mesh.positions.buffer,
        mesh.indices.buffer,
        ...(mesh.normals ? [mesh.normals.buffer] : []),
      ]),
    });
  } catch (error) {
    self.postMessage({
      id,
      ...readerProblemFields(error),
      error: errorMessage(error) || "Couldn't read this CAD file.",
      heap: occt?.HEAP8.length,
    } satisfies CadResponse);
  }
};
