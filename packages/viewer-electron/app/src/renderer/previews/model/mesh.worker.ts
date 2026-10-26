import { parseMesh } from './mesh-parser';
import { meshTransfers, type MeshFormat } from './mesh-data';
self.onmessage = (
  event: MessageEvent<{ id: number; source: string | ArrayBuffer; extension: MeshFormat }>,
) => {
  const request = event.data;
  try {
    const value = parseMesh(request.source, request.extension);
    self.postMessage({ id: request.id, value }, { transfer: meshTransfers(value) });
  } catch (error) {
    self.postMessage({ id: request.id, error: (error as Error).message });
  }
};
