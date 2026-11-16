import type { Sample } from '../types';
import { pdf, sample } from './documents';

const eps = `%!PS-Adobe-3.0 EPSF-3.0
%%Title: Print swatch
%%Creator: Viewer generated fixture
%%CreationDate: 2001-01-01
%%BoundingBox: 0 0 144 72
%%Pages: 1
%%LanguageLevel: 2
%%EndComments
0.2 0.4 0.6 setrgbcolor 0 0 72 72 rectfill
0.6 0.4 0.2 setrgbcolor 72 0 72 72 rectfill
showpage
%%EOF
`;

function tiff(): Buffer {
  const tags = [
    [256, 4, 16],
    [257, 4, 8],
    [258, 3, 8],
    [259, 3, 1],
    [262, 3, 1],
    [273, 4, 134],
    [277, 3, 1],
    [278, 4, 8],
    [279, 4, 128],
    [284, 3, 1],
  ];
  const data = Buffer.alloc(134 + 128);
  data.write('II');
  data.writeUInt16LE(42, 2);
  data.writeUInt32LE(8, 4);
  data.writeUInt16LE(tags.length, 8);
  for (const [index, [tag, type, value]] of tags.entries()) {
    const at = 10 + index * 12;
    data.writeUInt16LE(tag!, at);
    data.writeUInt16LE(type!, at + 2);
    data.writeUInt32LE(1, at + 4);
    data.writeUInt32LE(value!, at + 8);
  }
  for (let index = 0; index < 128; index++) data[134 + index] = index % 16 < 8 ? 32 : 224;
  return data;
}
function binary(): Buffer {
  const ps = Buffer.from(eps);
  const picture = tiff();
  const header = Buffer.alloc(30);
  header.set([0xc5, 0xd0, 0xd3, 0xc6]);
  header.writeUInt32LE(30, 4);
  header.writeUInt32LE(ps.length, 8);
  header.writeUInt32LE(30 + ps.length, 20);
  header.writeUInt32LE(picture.length, 24);
  header.writeUInt16LE(0xffff, 28);
  return Buffer.concat([header, ps, picture]);
}

export function postscriptSamples(): Sample[] {
  const picture = '%%BeginPreview: 16 4 1 4\n% aaaa\n% 5555\n% aaaa\n% 5555\n%%EndPreview\n';
  return [
    sample(
      'previews/print/Two pages.ps',
      ['ps'],
      'Comments and source; explicit Ghostscript rendering of two pages.',
      'Generated Level 2 print program with two colored pages.',
      Buffer.from(
        eps
          .replace(' EPSF-3.0', '')
          .replace('%%Pages: 1', '%%Pages: 2')
          .replace('%%EOF', '0 0 144 72 rectfill showpage\n%%EOF'),
      ),
    ),
    sample(
      'previews/print/TIFF picture.eps',
      ['eps'],
      'Labelled embedded TIFF picture and PostScript source.',
      'Binary EPS with validated disjoint PostScript and generated grayscale TIFF sections.',
      binary(),
    ),
    sample(
      'previews/print/No picture.epsf',
      ['epsf'],
      'Comments and source without an embedded picture.',
      'ASCII EPSF with a two-color drawing and a stated bounding box.',
      Buffer.from(eps),
    ),
    sample(
      'previews/print/Bitmap picture.epsi',
      ['epsi'],
      'Labelled EPSI bitmap, comments and source.',
      'EPSI with four declared bitmap rows and a two-color PostScript drawing.',
      Buffer.from(eps.replace('%%EndComments\n', '%%EndComments\n' + picture)),
    ),
    sample(
      'previews/print/Legacy drawing.ai',
      ['ai'],
      'Illustrator PostScript comments and source.',
      'Generated legacy Illustrator-compatible PostScript drawing with AI3 document comments.',
      Buffer.from(
        eps.replace(
          '%%EndComments',
          '%%AI3_ColorUsage: Color\n%%AI3_TemplateBox: 0 0 144 72\n%%EndComments',
        ),
      ),
    ),
    sample(
      'previews/print/PDF inside.ai',
      ['ai'],
      'Illustrator identity line and the existing PDF preview.',
      'Generated three-page PDF-compatible Illustrator inspection sample.',
      pdf(),
    ),
  ];
}
