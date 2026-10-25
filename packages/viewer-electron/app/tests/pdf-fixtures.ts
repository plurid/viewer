/** Real searchable/vector pages with optional embedded JPEG scan; all bytes are generated. */
export function workbenchPDF(
  labels: string[],
  scan?: { bytes: Buffer; width: number; height: number },
): Buffer {
  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => objects.push(Buffer.from(value));
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(
    `<< /Type /Pages /Count ${labels.length} /Kids [${labels.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const image = 4 + labels.length * 2;
  for (const [index, label] of labels.entries()) {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >>${scan ? ` /XObject << /Scan ${image} 0 R >>` : ''} >> /Contents ${5 + index * 2} 0 R >>`,
    );
    const content = `BT /F1 18 Tf 40 750 Td (${label}) Tj ET\n10 10 80 40 re S\n${scan ? 'q 520 0 0 650 40 60 cm /Scan Do Q\n' : ''}`;
    add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  if (scan)
    add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${scan.width} /Height ${scan.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${scan.bytes.length} >>\nstream\n`,
        ),
        scan.bytes,
        Buffer.from('\nendstream'),
      ]),
    );
  const parts = [Buffer.from('%PDF-1.4\n')],
    offsets = [0];
  let size = parts[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(size);
    const item = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(item);
    size += item.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
