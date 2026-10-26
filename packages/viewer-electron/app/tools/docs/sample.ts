/** A real one-page sample document for the public tutorial, not a QA report. */
export function fieldNotesPDF(jpeg: Uint8Array): Buffer {
  const content = Buffer.from(
    [
      '0.13 0.19 0.22 rg',
      'BT /Bold 32 Tf 50 734 Td (Field notes) Tj ET',
      '0.32 0.40 0.42 rg',
      'BT /Regular 12 Tf 50 709 Td (A weekend outdoors) Tj ET',
      'q 512 0 0 287 50 395 cm /Photo Do Q',
      '0.13 0.19 0.22 rg',
      'BT /Bold 16 Tf 50 360 Td (Make room for a slower morning.) Tj ET',
      'BT /Regular 11 Tf 50 337 Td (A short walk, a few photographs and time to look around.) Tj ET',
      'BT /Bold 12 Tf 50 289 Td (THE PLAN) Tj ET',
      'BT /Bold 12 Tf 330 289 Td (BRING ALONG) Tj ET',
      '0.32 0.40 0.42 rg',
      'BT /Regular 11 Tf 50 263 Td (Follow the woodland trail.) Tj ET',
      'BT /Regular 11 Tf 50 242 Td (Photograph the morning light.) Tj ET',
      'BT /Regular 11 Tf 50 221 Td (Save a few clips for later.) Tj ET',
      'BT /Regular 11 Tf 330 263 Td (Camera and notebook) Tj ET',
      'BT /Regular 11 Tf 330 242 Td (Water and a picnic) Tj ET',
      'BT /Regular 11 Tf 330 221 Td (A little extra time) Tj ET',
      '0.82 0.86 0.85 RG 50 112 m 562 112 l S',
      'BT /Regular 9 Tf 50 90 Td (Viewer sample document) Tj ET',
      'BT /Regular 8 Tf 50 72 Td (Image: Big Buck Bunny - Blender Foundation - CC BY 3.0) Tj ET',
    ].join('\n'),
  );
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /Regular 4 0 R /Bold 5 0 R >> /XObject << /Photo 6 0 R >> >> /Contents 7 0 R >>',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 640 /Height 359 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('\nendstream'),
    ]),
  ];
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')],
    offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(chunks.reduce((size, chunk) => size + chunk.length, 0));
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'));
  }
  const start = chunks.reduce((size, chunk) => size + chunk.length, 0);
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
        .join(
          '',
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
