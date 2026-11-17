declare module 'occt-import-js' {
  import type { ImportedCad } from './cad-data';
  export default function createOcct(options?: {
    wasmBinary?: ArrayBuffer;
    /** Emscripten's hook: instantiate the module and pass it on; the returned exports are filled later. */
    instantiateWasm?(
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ): object;
  }): Promise<{
    /** The WASM heap; its length is OCCT's memory in bytes. */
    HEAP8: Int8Array;
    ReadStepFile(
      data: Uint8Array,
      params: {
        linearUnit: string;
        linearDeflectionType: string;
        linearDeflection: number;
        angularDeflection: number;
      },
    ): ImportedCad;
    ReadIgesFile(
      data: Uint8Array,
      params: {
        linearUnit: string;
        linearDeflectionType: string;
        linearDeflection: number;
        angularDeflection: number;
      },
    ): ImportedCad;
  }>;
}
