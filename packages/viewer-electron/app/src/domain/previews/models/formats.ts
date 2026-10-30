/** Formats handled locally by the lazy 3D preview, independent of OS MIME mappings. */
export const modelFormats = [
  'glb',
  'gltf',
  'obj',
  'stl',
  'fbx',
  'step',
  'stp',
  'iges',
  'igs',
  '3mf',
  'ply',
  'dae',
  '3ds',
  'usdz',
  'x3d',
  'wrl',
  'off',
];
export const cadFormats = ['step', 'stp', 'iges', 'igs'];
/** Previewed from the file's own bytes and what it embeds. The textures, layers and worlds
 * these name are reported and never read, so their preview has no grant to the folder. */
export const selfContainedModelFormats = ['dae', '3ds', 'usdz', 'x3d', 'wrl', 'off'];
