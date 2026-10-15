/** R2007+ DXF is UTF-8 even when an inherited DWG codepage is present. */
export function decodeDXF(buffer: Uint8Array): string {
  const header = new TextDecoder().decode(buffer.subarray(0, 16384));
  const version = Number(/\$ACADVER\s+1\s+AC(\d+)/.exec(header)?.[1] || 0);
  const page = /\$DWGCODEPAGE\s+3\s+ANSI_(\d+)/.exec(header)?.[1];
  const eastAsian: Record<string, string> = {
    '932': 'shift_jis',
    '936': 'gbk',
    '949': 'euc-kr',
    '950': 'big5',
  };
  const encoding = version >= 1021 || !page ? 'utf-8' : (eastAsian[page] ?? `windows-${page}`);
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    throw new Error(
      `Drawing text encoding ${encoding} is not supported. Export a UTF-8 ASCII DXF (2007 or newer).`,
    );
  }
}
