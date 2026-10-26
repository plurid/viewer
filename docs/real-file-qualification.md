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

| Reference                                                          | Observed result on this Apple Silicon Mac                                                                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| qpdf 12.4.2 manual, 178 pages, 759 KB                              | PDF renders; page-count inspection confirms 178 pages.                                                                                                                                               |
| Apache POI `saut_page.docx`, 2.96 MB                               | Body text renders in five content blocks. This file has no body images and does not qualify embedded-image rendering. Page layout remains outside the semantic preview. |
| Apache POI `VariousPictures.docx`, 104 KB                          | Supported PNG/JPEG images decode; unsupported WMF/EMF are explicitly labeled. The pinned file and original hash are retained. |
| Apache POI `ConditionalFormattingSamples.xlsx`, 655 KB             | All 18 worksheet structures and saved cell values load. Conditional formatting, charts, drawings, external data and formula recalculation remain outside this semantic preview. Ordinary number formats are qualified separately below. |
| LibreOffice `LIBRE_OFFICE-116306-0.xlsx`, 2.86 MB / 28 MB expanded | On-demand pages render later source rows and independently load the second sheet. The 18 MB worksheet is fully scanned without a worksheet DOM; each interactive page retains up to 100 stored rows. |
| Apache POI `deep-data.xlsx`, 965 KB                                | Explicit corrupt-ZIP refusal: central directory missing. This is a negative reference, retained intact.                                                                                              |
| Original Nikon Z6 NEF, 26 MB; Ricoh GR III DNG, 33 MB              | Qualified through the independent LibRaw helper: embedded camera image and explicit half-size RAW rendition, with actual image pixels and warm reuse. Their original hashes remain unchanged. |
| Big Buck Bunny trailer, 33 seconds, Theora/Vorbis OGV              | Complete local H.264/AAC compatibility copy: actual 720×400 video pixels, decoded audio, advancing playback, seek, range reads, cancellation and warm reuse pass. The original remains unchanged.                 |

Initial measured cold/warm document reads were about 6/3 ms for Word and 24/14 ms
for the 18-sheet workbook. Actual Quick Preview opening took roughly 0.1–0.5 s
for the supported documents. These are local observations on these exact samples,
not performance guarantees or compression benchmarks. The earlier baseline packaged run is
recorded in `/private/tmp/viewer-real-file-previews-done.log`, with captures and
`result.json` in the retained temporary folder `viewer-native-real-files-mrGEh9`.
It verifies unchanged source hashes, no file-operation jobs, advancing fallback
audio playback and graceful app exit after both RAW timeouts.

The earlier unpaged worksheet streaming follow-up passes on the packaged app in
`/private/tmp/viewer-office-streaming-native.log`, with captures and `result.json`
in `viewer-native-real-files-dqiJG0`. The previously rejected large workbook
loads in about 609 ms cold and 61 ms from the extraction cache; the measured
Quick Preview sequence takes 1.09 seconds including both inspection reads. Its
first sheet retains 50,000 cells across 402 source rows and 126 columns. The
second sheet is present but has no retained cells because the shared cell budget
is exhausted; both the data and UI report truncation. Further ranges/sheets need
on-demand reading. This run also verifies the other references, unchanged source
hashes, no file-operation jobs and graceful app exit. These timings qualify this
exact sample and machine, not arbitrary workbooks.

Interactive worksheet paging now removes that shared-preview starvation from the
UI. The packaged `tests/native/worksheet-pages.ts` run loads rows 5000–5099 of
the public worksheet and independently loads Documents Analysis. Its requested
page contains 12,178 cells and reports the true last source row, 5392; the measured
uncached read takes about 546 ms. The native check also verifies source-row 2500
citations, final-page and Previous behavior, actual Return-key row submission,
remembered sheet positions, malformed-page recovery and external-target refusal.
Log: `/private/tmp/viewer-office-pagination-native-5.log`; source copies, five
dark/light/760px captures and result data:
`viewer-native-worksheet-pages-fYe32e` under the macOS temporary root. Original
hashes are unchanged, no file-operation jobs occur, and both owned apps quit
cleanly. The inherited 760px spatial framing does not establish native mobile
or physical assistive-technology qualification.

The earlier RAW stall also reproduced outside Viewer's coordination layer in a fresh
Electron process, at a 1024px thumbnail request: no result within 14 seconds.
The retained direct probe is `/private/tmp/viewer-quicklook-probe-M4sPtx` and its
log `/private/tmp/viewer-quicklook-direct.log`. Viewer keeps at most two actual
system render requests pending, cancels its own wait on release/revocation and
ignores late bytes. A stuck native service can still require reopening Viewer;
Viewer does not promise to cancel macOS's internal decoder work.

The independent RAW follow-up passes in `/private/tmp/viewer-raw-20261025-E/Viewer.app`.
`tests/native/raw-previews.ts` retains source copies, four dark/light/narrow/error
captures and result data in `viewer-native-raw-gYVvRk`; log
`/private/tmp/viewer-raw-native-5-20261025.log`. Both camera files render through
both paths. Generated DNG copies exercise all eight TIFF orientations; fourteen
nonidentity comparisons against independently oriented reference pixels stay
below 2.06 mean absolute error on 8-bit channels. These are generated variants,
not fourteen additional camera-model qualifications. A corrupt NEF fails promptly
with Retry. A generated unsupported JPEG-XL tag leaves its camera image intact;
the test verifies failed RAW rendering can return to that camera view. Independent
UI review scored this recovery fix resolved. The complete suite passes 1,842 tests in 260 files. Optional lossy-JPEG
DNG, RawSpeed/DNG SDK and external color-profile adapters are not compiled;
the decoder's full camera list is not a claim of tested Viewer coverage.

The Office fidelity follow-up passes against
`/private/tmp/viewer-office-20261025-A/Viewer.app`. Native evidence in
`viewer-native-office-fidelity-ydDDzz` covers generated numbers, dates, stored
values, cached formulas and cross-page merged anchors; generated body/table
PNG/JPEG images, placeholders and source-bound image grants; and the public
VariousPictures and 18-sheet workbook. Log:
`/private/tmp/viewer-office-native-4-20261025.log`. The public Word reference is
103,677 bytes with SHA-256
`c1eecbca7de9f99e21c677e1d5b045eaa1d5a442eff4c82f0cbe9af93726a070`.
All four source hashes remain unchanged and no file-operation job runs.

The video compatibility follow-up passes against
`/private/tmp/viewer-video-20261025-C/Viewer.app`, with retained evidence in
`viewer-native-video-copy-J9M9kk` and
`/private/tmp/viewer-video-native-4-20261025.log`. The public OGV now has actual
picture/audio playback and seeking through a bounded complete compatibility
copy. The earlier audio-only observation describes its earlier candidate.

Remaining work follows evidence: index worksheet rows for faster uncached random
access, improve Office layout/graphics coverage and qualify additional real
camera/codec samples. Current source-preservation, bounded rejection and honest
codec labels remain required.
