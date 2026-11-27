/** A refusal written by the DXF reader, safe to carry across its worker boundary. */
export class DXFReadError extends Error {}

const windowsPages: Record<string, string> = {
  '932': 'shift_jis',
  '936': 'gbk',
  '949': 'euc-kr',
  '950': 'big5',
  '65001': 'utf-8',
};

/** R2007+ DXF is UTF-8 even when an inherited DWG codepage is present. */
export function decodeDXF(buffer: Uint8Array): string {
  const utf8 = new TextDecoder().decode(buffer);
  const end = utf8.search(/^[ \t]*0\s+ENDSEC[ \t]*$/im);
  const header = end < 0 ? utf8 : utf8.slice(0, end);
  const section = /^[ \t]*SECTION\s+2\s+([^\r\n]+)/im.exec(header);
  if (section && section[1]!.trim().toUpperCase() !== 'HEADER') return utf8;
  const version = Number(/^[ \t]*\$ACADVER\s+1\s+AC(\d+)/im.exec(header)?.[1] ?? 0);
  if (version >= 1021) return utf8;

  const page = /^[ \t]*\$DWGCODEPAGE\s+3[ \t]*(?:\r\n?|\n)([^\r\n]*)/im.exec(header)?.[1]?.trim();
  if (page === undefined) return utf8;
  const ansi = /^ANSI_(\d+)$/i.exec(page)?.[1];
  const encoding = ansi
    ? (windowsPages[ansi] ?? `windows-${ansi}`)
    : page.replace(/^DOS(\d+)$/i, 'ibm$1');
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    const label = ansi ? encoding : page;
    const reason = /^(?:windows-\d{1,5}|DOS\d{1,5})$/i.test(label)
      ? `Drawing text encoding ${label} is not supported.`
      : 'This drawing uses an unsupported text encoding.';
    throw new DXFReadError(reason + ' Export a UTF-8 ASCII DXF (2007 or newer).');
  }
}
