# Real-file preview qualification

The October 25 corpus lives in the stable playground's `qualification/` folder.
Run `pnpm playground:qualify` to add the pinned references and separate v2
manifest. The generator preserves all existing files, the original playground
manifest, Git projects and historical metadata. Downloads verify decoded byte
count and SHA256, including compressed HTTP transfers. Apache POI references
are pinned to commit `5c44755a2a7569a5884dc8f1f680ca3a86fa245f`, with its original
distribution license. qpdf's upstream manual is pinned by size and checksum.

`tests/native/real-file-previews.ts` opens a separate packaged app/profile with
copies of the public references. It records cold/warm document inspection,
actual Quick Preview outcomes, screenshots, source hashes, zero file-operation
jobs and graceful shutdown. Sample presence is not universal decoder support.

| Reference                                                          | Observed result on this Apple Silicon Mac                                                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| qpdf 12.4.2 manual, 178 pages, 759 KB                              | PDF renders; page-count inspection confirms 178 pages.                                                                                                                                            |
| Apache POI `saut_page.docx`, 2.96 MB                               | Body text renders. Five content blocks; layout, embedded images and other Word features remain omitted, as disclosed by Preview details.                                                          |
| Apache POI `ConditionalFormattingSamples.xlsx`, 655 KB             | All 18 worksheet structures and saved cell values load. Formatting, charts, drawings, external data and formula recalculation remain outside this semantic preview.                               |
| LibreOffice `LIBRE_OFFICE-116306-0.xlsx`, 2.86 MB / 28 MB expanded | Explicit reader-limit refusal. Its largest XML part is 18 MB; the current Office reader allows 4 MB per part and 32 MB total. The package's compressed size does not establish its decoding cost. |
| Apache POI `deep-data.xlsx`, 965 KB                                | Explicit corrupt-ZIP refusal: central directory missing. This is a negative reference, retained intact.                                                                                           |
| Original Nikon Z6 NEF, 26 MB; Ricoh GR III DNG, 33 MB              | This Mac's system thumbnail API did not answer. Viewer now reports a 12-second timeout, exposes Retry and quits cleanly; these two samples are **not qualified as rendered RAW previews**.        |
| Big Buck Bunny trailer, 33 seconds, Theora/Vorbis OGV              | Audio playback advances in the fallback audio player; the current Chromium build supplies no video picture. The UI labels this partial result. This is not qualified video playback.              |

Initial measured cold/warm document reads were about 6/3 ms for Word and 24/14 ms
for the 18-sheet workbook. Actual Quick Preview opening took roughly 0.1–0.5 s
for the supported documents. These are local observations on these exact samples,
not performance guarantees or compression benchmarks. The final packaged run is
recorded in `/private/tmp/viewer-real-file-previews-done.log`, with captures and
`result.json` in the retained temporary folder `viewer-native-real-files-mrGEh9`.
It verifies unchanged source hashes, no file-operation jobs, advancing fallback
audio playback and graceful app exit after both RAW timeouts.

The RAW stall also reproduces outside Viewer's coordination layer in a fresh
Electron process, at a 1024px thumbnail request: no result within 14 seconds.
The retained direct probe is `/private/tmp/viewer-quicklook-probe-M4sPtx` and its
log `/private/tmp/viewer-quicklook-direct.log`. Viewer keeps at most two actual
system render requests pending, cancels its own wait on release/revocation and
ignores late bytes. A stuck native service can still require reopening Viewer;
Viewer does not promise to cancel macOS's internal decoder work.

Remaining work follows evidence: stream or page large worksheet XML, improve
Office layout/graphics coverage, add a RAW decoder independent of Quick Look,
and provide a supported local video rendition for codecs Chromium cannot show.
Current source-preservation, bounded rejection and codec labels remain required
while those adapters are developed.
