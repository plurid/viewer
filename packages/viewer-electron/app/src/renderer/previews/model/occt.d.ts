declare module 'occt-import-js' {
  import type { ImportedCad } from './cad-data';
  export default function createOcct(options?: { wasmBinary?: ArrayBuffer }): Promise<{
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
