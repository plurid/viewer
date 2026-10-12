/** Synthetic CAD fixtures; no user drawing is stored in this repository. */
export const entity = (type: string, pairs: (string | number)[]) =>
  ['0', type, ...pairs].join('\n') + '\n';
export function dxf(entities: string, units = 4, blocks = ''): string {
  return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n${units}\n9\n$EXTMIN\n10\n1e+20\n20\n1e+20\n9\n$EXTMAX\n10\n-1e+20\n20\n-1e+20\n0\nENDSEC\n${blocks ? `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n` : ''}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}
export const panelDrawing = dxf(
  entity('LINE', [8, 'CUT', 10, 0, 20, 0, 11, 200, 21, 0]) +
    entity('LINE', [8, 'CUT', 10, 200, 20, 0, 11, 200, 21, 100]) +
    entity('LINE', [8, 'CUT', 10, 200, 20, 100, 11, 0, 21, 100]) +
    entity('LINE', [8, 'CUT', 10, 0, 20, 100, 11, 0, 21, 0]) +
    entity('CIRCLE', [8, 'HOLES', 10, 50, 20, 50, 40, 10]) +
    entity('ELLIPSE', [
      8,
      'CURVES',
      10,
      140,
      20,
      50,
      11,
      30,
      21,
      0,
      40,
      0.5,
      41,
      0,
      42,
      Math.PI * 2,
    ]),
);
