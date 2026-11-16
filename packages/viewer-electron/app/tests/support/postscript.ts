export const postscriptSample = `%!PS-Adobe-3.0
%%Title: Two squares
%%Creator: Viewer generated fixture
%%CreationDate: 2001-01-01
%%Pages: 2
%%BoundingBox: 0 0 144 72
%%LanguageLevel: 3
%%EndComments
0 0 72 72 rectfill showpage
72 0 72 72 rectfill showpage
%%EOF
`;

export function binaryEPSSample(
  source = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 2 1\nshowpage\n',
  tiff: Buffer = Buffer.alloc(0),
  wmf: Buffer = Buffer.alloc(0),
): Buffer {
  const ps = Buffer.from(source);
  const header = Buffer.alloc(30);
  header.set([0xc5, 0xd0, 0xd3, 0xc6]);
  header.writeUInt32LE(30, 4);
  header.writeUInt32LE(ps.length, 8);
  if (wmf.length) {
    header.writeUInt32LE(30 + ps.length, 12);
    header.writeUInt32LE(wmf.length, 16);
  }
  if (tiff.length) {
    header.writeUInt32LE(30 + ps.length + wmf.length, 20);
    header.writeUInt32LE(tiff.length, 24);
  }
  header.writeUInt16LE(0xffff, 28);
  return Buffer.concat([header, ps, wmf, tiff]);
}

export const epsiSample = `%!PS-Adobe-3.0 EPSF-3.0
%%Title: Saved bitmap
%%BeginPreview: 8 2 1 2
% aa
% 55
%%EndPreview
showpage
`;

export function tiffSample(): Buffer {
  const tags = [
    [256, 4, 2], [257, 4, 1], [258, 3, 8], [259, 3, 1], [262, 3, 1],
    [273, 4, 134], [277, 3, 1], [278, 4, 1], [279, 4, 2], [284, 3, 1],
  ];
  const bytes = Buffer.alloc(136);
  bytes.write('II');
  bytes.writeUInt16LE(42, 2);
  bytes.writeUInt32LE(8, 4);
  bytes.writeUInt16LE(tags.length, 8);
  for (const [index, [tag, type, value]] of tags.entries()) {
    const offset = 10 + index * 12;
    bytes.writeUInt16LE(tag!, offset);
    bytes.writeUInt16LE(type!, offset + 2);
    bytes.writeUInt32LE(1, offset + 4);
    bytes.writeUInt32LE(value!, offset + 8);
  }
  bytes[134] = 0;
  bytes[135] = 255;
  return bytes;
}

export function pdfSample(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += 'xref\n0 5\n0000000000 65535 f \n';
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
