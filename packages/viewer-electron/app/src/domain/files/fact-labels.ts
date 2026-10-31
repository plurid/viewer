/**
 * Readable names for inspection facts: those desktop/files/inspection.ts measures and the document
 * metadata the readers return. People read them in Inspect file and in workflow results; agents and
 * the CLI keep the raw keys, which are the contract.
 */
const factLabels: Readonly<Record<string, string>> = {
  bytes: 'Size',
  kind: 'Kind',
  characters: 'Characters',
  drawingWidth: 'Drawing width',
  drawingHeight: 'Drawing height',
  drawingUnits: 'Drawing units',
  entities: 'Entities',
  layers: 'Layers',
  contourLength: 'Contour length',
  closedContourArea: 'Closed contour area',
  width: 'Width',
  height: 'Height',
  pixels: 'Pixels',
  worksheets: 'Worksheets',
  cells: 'Cells',
  formulas: 'Formulas',
  missingCachedValues: 'Formulas without saved values',
  rows: 'Rows',
  columns: 'Columns',
  pages: 'Pages',
  messages: 'Messages',
  // PDF information keys arrive lowercased (desktop/previews/formats.ts)
  creationdate: 'Created',
  moddate: 'Modified',
  pdfformatversion: 'PDF version',
  url: 'Address',
};

/** "missingCachedValues" reads "Formulas without saved values"; an unknown "pageCount", "Page count". */
export function factLabel(key: string): string {
  if (Object.hasOwn(factLabels, key)) return factLabels[key]!;
  const words = key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}
