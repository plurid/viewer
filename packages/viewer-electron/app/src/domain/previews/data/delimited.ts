/** RFC 4180-style bounded CSV parser. Omitted records are still scanned so an
 * unterminated quoted suffix cannot be mistaken for a complete valid table. */
export function parseDelimited(
  text: string,
  delimiter = ',',
  limits: { rows?: number; cells?: number } = {},
): { rows: string[][]; malformed: boolean; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let empty = true,
    started = false,
    retained = 0,
    truncated = false;
  const maxRows = Math.min(100000, limits.rows ?? 100000);
  const maxCells = Math.min(500000, limits.cells ?? 500000);
  const collecting = () => rows.length < maxRows && retained < maxCells;
  const append = (value: string) => {
    started = true;
    empty = false;
    if (collecting()) cell += value;
  };
  const field = () => {
    if (collecting()) {
      row.push(cell);
      retained++;
    } else truncated = true;
    cell = '';
    empty = true;
  };
  const record = () => {
    field();
    if (row.length) rows.push(row);
    row = [];
    started = false;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && (quoted || empty)) {
      started = true;
      if (quoted && text[index + 1] === '"') {
        append('"');
        index++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      started = true;
      field();
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      record();
    } else append(char!);
  }
  if (started || row.length) record();
  return { rows, malformed: quoted, truncated };
}
