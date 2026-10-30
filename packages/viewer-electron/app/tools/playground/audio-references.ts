import type { RemoteSample } from './types';

// Neither encoder is in FFmpeg's LGPL build: these are other projects' test files, unmodified.
const media =
  'https://raw.githubusercontent.com/androidx/media/8c6678b657ede1e7883fc164ef73ed483c7796c3/';
const taglib =
  'https://raw.githubusercontent.com/taglib/taglib/ff3b53670a306a096aacad7c61236b38739e6c81/';

export const audioReferenceSamples: RemoteSample[] = [
  {
    path: 'previews/audio/AMR narrowband.amr',
    formats: ['amr'],
    preview: 'A compatibility copy: Chromium does not play AMR.',
    description: 'A 4-second AMR-NB test recording from AndroidX Media, unmodified.',
    source: media + 'libraries/test_data/src/test/assets/media/amr/sample_nb.amr',
    license: 'Apache-2.0; ' + media + 'LICENSE',
    url: media + 'libraries/test_data/src/test/assets/media/amr/sample_nb.amr',
    sha256: '04988cb21a65d42857747e3d3c770da57d3319e9da34e3e2d57db015014ad4e9',
    size: 2840,
  },
  {
    path: "previews/audio/Monkey's Audio tone.ape",
    formats: ['ape'],
    preview: "A compatibility copy: Chromium does not play Monkey's Audio.",
    description:
      "A 3.5-second 440 Hz tone at full level, written by Monkey's Audio 3.99, from TagLib's tests, unmodified.",
    source: taglib + 'tests/data/mac-399.ape',
    license: 'LGPL-2.1 or MPL-1.1; ' + taglib + 'COPYING.LGPL',
    url: taglib + 'tests/data/mac-399.ape',
    sha256: '8c851b4f52bbbd822262040ae8961b8c27f8f702d1be3fa50cca283d009aadea',
    size: 85212,
  },
];
