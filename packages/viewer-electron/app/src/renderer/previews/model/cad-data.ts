export interface ImportedCad {
  success: boolean;
  meshes: {
    name: string;
    color?: number[];
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    index: { array: number[] };
  }[];
}
export interface CadMesh {
  name: string;
  color?: number[];
  positions: Float32Array;
  normals?: Float32Array;
  indices: Uint32Array;
}
export type CadReply = { meshes: CadMesh[]; error?: never } | { error: string; meshes?: never };

/** Validate converter output before allocating GPU geometry. A worker owns the converter's heap. */
export function cadMeshes(result: ImportedCad): CadMesh[] {
  if (!result.success || !result.meshes?.length)
    throw new Error('No geometry could be read from this CAD file.');
  if (result.meshes.length > 10000)
    throw new Error('This CAD assembly has too many parts to preview.');
  let vertices = 0,
    triangles = 0;
  return result.meshes.map((mesh) => {
    const positions = mesh.attributes.position.array,
      normals = mesh.attributes.normal?.array,
      indices = mesh.index.array;
    vertices += positions.length / 3;
    triangles += indices.length / 3;
    if (vertices > 4000000 || triangles > 2000000)
      throw new Error('This CAD model exceeds the geometry limit for previews.');
    if (
      !positions.length ||
      positions.length % 3 ||
      indices.length % 3 ||
      positions.some((value) => !Number.isFinite(value)) ||
      indices.some(
        (value) => !Number.isInteger(value) || value < 0 || value >= positions.length / 3,
      ) ||
      (normals &&
        (normals.length !== positions.length || normals.some((value) => !Number.isFinite(value))))
    )
      throw new Error('This CAD file produced invalid geometry.');
    return {
      name: mesh.name,
      color:
        mesh.color?.length === 3 &&
        mesh.color.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
          ? mesh.color
          : undefined,
      positions: new Float32Array(positions),
      normals: normals ? new Float32Array(normals) : undefined,
      indices: new Uint32Array(indices),
    };
  });
}
