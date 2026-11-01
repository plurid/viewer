import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Canvases } from './service';
import type { CanvasSource } from '../../domain/canvases/sources';
import { canvasLimits } from '../../domain/canvases/document';

/** Resolve inert relative names without reading a companion before authorization. */
export async function robotMeshPaths(
  source: CanvasSource,
): Promise<{ resource: string; path: string }[]> {
  if (!source.path || !source.data.robot) throw new Error('Attach an original URDF source first.');
  const folder = path.dirname(source.path);
  const resources = [
    ...new Set(
      source.data.robot.links.flatMap((link) =>
        link.visuals.flatMap((visual) =>
          visual.geometry.kind === 'mesh' ? [visual.geometry.resource] : [],
        ),
      ),
    ),
  ];
  if (resources.length > canvasLimits.assets)
    throw new Error('The robot has too many mesh resources.');
  const result: { resource: string; path: string }[] = [];
  for (const resource of resources) {
    if (
      !/\.stl$/i.test(resource) ||
      /[\\:\u0000-\u001f]/.test(resource) ||
      resource.startsWith('/') ||
      resource.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(
        'Robot meshes must be relative STL files inside the model folder. Package and external URLs are not supported.',
      );
    const file = path.join(folder, resource);
    result.push({ resource, path: file });
  }
  return result;
}

export function validateRobotSTL(bytes: Uint8Array): void {
  if (bytes.length < 84) throw new Error('The robot mesh is not a binary STL.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  if (!triangles || triangles > 200_000 || bytes.length !== 84 + triangles * 50)
    throw new Error('Robot meshes must be binary STL with at most 200,000 triangles.');
  for (let triangle = 0; triangle < triangles; triangle++)
    for (let component = 0; component < 12; component++) {
      const value = view.getFloat32(84 + triangle * 50 + component * 4, true);
      if (!Number.isFinite(value) || Math.abs(value) > 1e6)
        throw new Error('The robot mesh has invalid coordinates.');
    }
}

/** Resolve and authorize every companion before attaching any bytes. No scope is inferred. */
export async function attachRobotMeshes(
  canvases: Canvases,
  owner: number,
  id: string,
  source: CanvasSource,
  authorize: (file: string) => Promise<string>,
  signal: AbortSignal,
) {
  const current = async () => {
    signal.throwIfAborted();
    const document = await canvases.read(owner, id);
    if (!document.sources.some((item) => item.id === source.id && item.hash === source.hash))
      throw new Error(
        'The robot source changed. Read the current snapshot before attaching meshes.',
      );
    return document;
  };
  await current();
  const files = await robotMeshPaths(source);
  for (const file of files) {
    signal.throwIfAborted();
    if ((await authorize(file.path)) !== file.path) throw new Error('The robot mesh path changed.');
    if ((await realpath(file.path)) !== file.path)
      throw new Error('Robot mesh paths must not contain links.');
  }
  const resources: { resource: string; assetID: string }[] = [];
  for (const file of files) {
    await current();
    if ((await authorize(file.path)) !== file.path || (await realpath(file.path)) !== file.path)
      throw new Error('The robot mesh path changed.');
    const asset = await canvases.attachFile(owner, id, file.path, validateRobotSTL);
    resources.push({ resource: file.resource, assetID: asset.id });
  }
  return { resources, revision: (await current()).revision };
}
