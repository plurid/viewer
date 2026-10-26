import type { Plugin } from 'vite';

/** r186 shares CPU lookup data, but its uploaded texture must belong to a renderer.
 * The shared texture's dispose listeners otherwise retain every old WebGL context.
 * Keep the installed dependency intact and refuse an unreviewed source change. */
export function ownRendererLookup(code: string): string {
  const start = code.indexOf('class WebGLRenderer {');
  if (start < 0) throw new Error('Three.js WebGLRenderer source was not found.');
  let renderer = code.slice(start);
  for (const [before, after] of [
    ['constructor( parameters = {} ) {', 'constructor( parameters = {} ) {\n\t\tlet viewerDFGLUT;'],
    [
      'm_uniforms.dfgLUT.value = getDFGLUT();',
      'm_uniforms.dfgLUT.value = ( viewerDFGLUT ??= getDFGLUT().clone() );',
    ],
    [
      'this.dispose = function () {',
      'this.dispose = function () {\n\t\t\tviewerDFGLUT?.dispose();\n\t\t\tviewerDFGLUT = undefined;',
    ],
  ]) {
    if (renderer.split(before).length !== 2)
      throw new Error('Review the Three.js lookup texture lifecycle after updating Three.js.');
    renderer = renderer.replace(before, after);
  }
  return code.slice(0, start) + renderer;
}

export function threeRendererOwnership(): Plugin {
  return {
    name: 'viewer-three-renderer-ownership',
    enforce: 'pre',
    transform(code, id) {
      if (!/[/\\]three[/\\]build[/\\]three\.module\.js(?:\?|$)/.test(id)) return;
      return { code: ownRendererLookup(code), map: null };
    },
  };
}
