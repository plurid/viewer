import * as THREE from 'three';
import { meshTriangleLimit, meshVertexLimit } from './mesh-data';

const geometryLimit = () => new Error('This model exceeds the geometry limit for previews.');
const malformed = (line: number) => new Error(`This OFF file is malformed at line ${line}.`);

/** A color written as 0 to 1, or as 0 to 255 when any component exceeds 1. */
function color(values: number[], line: number): THREE.Color {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw malformed(line);
  const scale = values.some((value) => value > 1) ? 1 / 255 : 1;
  const [red = 0, green = 0, blue = 0] = values.map((value) => Math.min(value * scale, 1));
  return new THREE.Color().setRGB(red, green, blue, THREE.SRGBColorSpace);
}

/** Geomview OFF: a header keyword, the vertex, face and edge counts, then one vertex and one
 * face per line. Prefixes add vertex normals (N), colors (C) and texture coordinates (ST);
 * a face may end with its own color. Polygons are triangulated as fans. */
export function parseOFF(text: string): THREE.BufferGeometry {
  const lines = text.split(/\r\n|\r|\n/);
  let cursor = 0;
  const next = (): { tokens: string[]; line: number } => {
    while (cursor < lines.length) {
      const content = lines[cursor++]!.replace(/#.*/, '').trim();
      if (content) return { tokens: content.split(/\s+/), line: cursor };
    }
    throw new Error('This OFF file ends before its last face.');
  };
  const first = next();
  const header = /^(ST)?(C)?(N)?(4)?(n)?OFF(.*)$/.exec(first.tokens.join(' '));
  if (!header) throw new Error('This file does not start with an OFF header.');
  const [, textured, colored, normals, homogeneous, dimensioned, rest = ''] = header;
  if (/^\s*BINARY/.test(rest)) throw new Error('Binary OFF files are not supported.');
  if (homogeneous || dimensioned)
    throw new Error('Only three-dimensional OFF files are supported.');
  const counts = rest.trim() ? { tokens: rest.trim().split(/\s+/), line: first.line } : next();
  const [vertexCount = NaN, faceCount = NaN] = counts.tokens.map(Number);
  if (![vertexCount, faceCount].every((count) => Number.isSafeInteger(count) && count >= 0))
    throw malformed(counts.line);
  if (vertexCount > meshVertexLimit || faceCount > meshTriangleLimit) throw geometryLimit();

  const positions = new Float32Array(vertexCount * 3);
  const vertexColors = colored ? new Float32Array(vertexCount * 3) : undefined;
  const leading = 3 + (normals ? 3 : 0);
  const trailing = textured ? 2 : 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const { tokens, line } = next();
    const values = tokens.map(Number);
    if (
      values.length < leading + trailing ||
      values.slice(0, 3).some((value) => !Number.isFinite(value))
    )
      throw malformed(line);
    positions.set(values.slice(0, 3), vertex * 3);
    if (vertexColors) {
      const components = values.slice(leading, values.length - trailing);
      if (components.length < 3 || components.length > 4) throw malformed(line);
      color(components, line).toArray(vertexColors, vertex * 3);
    }
  }

  const index: number[] = [];
  const faceColors: THREE.Color[] = [];
  let everyFaceColored = true;
  for (let face = 0; face < faceCount; face++) {
    const { tokens, line } = next();
    const size = Number(tokens[0]);
    if (!Number.isSafeInteger(size) || size < 0 || tokens.length < size + 1) throw malformed(line);
    // A point or an edge has no surface to show.
    if (size < 3) continue;
    const corners = tokens.slice(1, size + 1).map(Number);
    if (corners.some((corner) => !Number.isInteger(corner) || corner < 0 || corner >= vertexCount))
      throw new Error('This model has invalid geometry indices.');
    if (index.length / 3 + size - 2 > meshTriangleLimit) throw geometryLimit();
    for (let corner = 1; corner < size - 1; corner++)
      index.push(corners[0]!, corners[corner]!, corners[corner + 1]!);
    // A face color has three or four components; one value indexes a color map, which the
    // file does not carry.
    const components = tokens.slice(size + 1).map(Number);
    if (components.length >= 3 && components.length <= 4) {
      const shade = color(components, line);
      for (let corner = 1; corner < size - 1; corner++) faceColors.push(shade);
    } else everyFaceColored = false;
  }

  const geometry = new THREE.BufferGeometry();
  if (everyFaceColored && faceColors.length) {
    // Face colors belong to corners, so each triangle gets its own three vertices.
    const corners = new Float32Array(index.length * 3);
    const shades = new Float32Array(index.length * 3);
    index.forEach((vertex, corner) => {
      corners.set(positions.subarray(vertex * 3, vertex * 3 + 3), corner * 3);
      faceColors[Math.floor(corner / 3)]!.toArray(shades, corner * 3);
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(corners, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(shades, 3));
    return geometry;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (vertexColors) geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
  return geometry;
}
