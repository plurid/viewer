/** Unmodified upstream collections: JP/KR/SC/TC/HK serif, sans and monospace faces.
 * These are build-time sources; installed previews make no font downloads. */
export const officeFontCache = 'viewer-office-fonts-v1';
export const officeFonts = [
  {
    name: 'NotoSansCJK-Regular.ttc',
    virtualPath: '/instdir/share/fonts/truetype/NotoSansCJK-Regular.ttc',
    bytes: 19484784,
    sha256: 'b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a',
    url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/OTC/NotoSansCJK-Regular.ttc',
  },
  {
    name: 'NotoSerifCJK-Regular.ttc',
    virtualPath: '/instdir/share/fonts/truetype/NotoSerifCJK-Regular.ttc',
    bytes: 26297400,
    sha256: 'a04178ec485dffdff7cc0c0c20e1fce9202d7e2160d805e8e44a4c8841c58481',
    url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Serif/OTC/NotoSerifCJK-Regular.ttc',
  },
] as const;

// A missing named CJK family must retain its script and serif/sans style.
// These are fallbacks, not claims of metric equivalence with proprietary fonts.
const fallbacks = [
  ['MS Mincho', 'Noto Serif CJK JP'],
  ['MS PMincho', 'Noto Serif CJK JP'],
  ['ＭＳ 明朝', 'Noto Serif CJK JP'],
  ['ＭＳ Ｐ明朝', 'Noto Serif CJK JP'],
  ['Yu Mincho', 'Noto Serif CJK JP'],
  ['MS Gothic', 'Noto Sans CJK JP'],
  ['MS PGothic', 'Noto Sans CJK JP'],
  ['ＭＳ ゴシック', 'Noto Sans CJK JP'],
  ['ＭＳ Ｐゴシック', 'Noto Sans CJK JP'],
  ['Meiryo', 'Noto Sans CJK JP'],
  ['Yu Gothic', 'Noto Sans CJK JP'],
  ['SimSun', 'Noto Serif CJK SC'],
  ['NSimSun', 'Noto Serif CJK SC'],
  ['宋体', 'Noto Serif CJK SC'],
  ['SimHei', 'Noto Sans CJK SC'],
  ['Microsoft YaHei', 'Noto Sans CJK SC'],
  ['微软雅黑', 'Noto Sans CJK SC'],
  ['PMingLiU', 'Noto Serif CJK TC'],
  ['MingLiU', 'Noto Serif CJK TC'],
  ['新細明體', 'Noto Serif CJK TC'],
  ['MingLiU_HKSCS', 'Noto Serif CJK HK'],
  ['Microsoft JhengHei', 'Noto Sans CJK TC'],
  ['Batang', 'Noto Serif CJK KR'],
  ['BatangChe', 'Noto Serif CJK KR'],
  ['바탕', 'Noto Serif CJK KR'],
  ['Malgun Gothic', 'Noto Sans CJK KR'],
  ['Gulim', 'Noto Sans CJK KR'],
  ['Dotum', 'Noto Sans CJK KR'],
] as const;

export const officeFontConfiguration = {
  name: '99-viewer-cjk.conf',
  virtualPath: '/instdir/share/fontconfig/conf.d/99-viewer-cjk.conf',
  text:
    '<?xml version="1.0"?><fontconfig>' +
    fallbacks
      .map(
        ([family, substitute]) =>
          `<alias binding="same"><family>${family}</family><accept><family>${substitute}</family></accept></alias>`,
      )
      .join('') +
    '</fontconfig>',
} as const;
