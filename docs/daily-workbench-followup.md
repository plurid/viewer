# Daily workbench follow-up

Ordered implementation requested on October 25, 2026:

1. **Column consistency:** resolve presentation commands from the browsed folder,
   including live sorting/direction, hidden files, reset/defaults and refresh.
   Changing view or navigating upward keeps the current folder context. Verify
   the real nested-column command sequence and preserve all fixtures.
2. **PDF workbench:** create new PDFs by merging, splitting, reordering, rotating
   and extracting pages. Add an explicit stronger compression option for scanned
   images while retaining text/vector content and preserving originals. Reuse
   bounded typed plans, bundled processors and guarded operation publication.
3. **Reusable quick presets:** images for web, PDF for email, audio extraction and
   batch conversion through the command palette and reviewed typed actions.
4. **Real-file qualification:** exercise representative larger documents, images
   and media in the stable playground, recording partial-format and codec limits.

Step 1 implementation uses `renderer/commands/folder-target.ts` as the shared
current-folder rule. Four new command regressions first fail on the previous
code; the corrected folder/command/navigation/refresh suite passes 44 tests.
TypeScript, targeted lint, packaging and native acceptance pass. The packaged
`tests/native/inspection-tools.ts` run covers sorting, hidden files, reset,
defaults, view switching, parent navigation and child-folder search. Evidence:
`/private/tmp/viewer-column-consistency-native.log`; screenshots and fixtures:
`/var/folders/nq/spvmjp8n4w923_2t1nj63l6r0000gn/T/viewer-native-inspection-7zOvE4`.
Step 1 is complete.

Step 2 is complete: **PDF tools…** merges, extracts, reorders, rotates and splits
pages through typed guarded operations. **Optimize…** now explicitly recompresses
compatible JPEG scans while preserving text and vectors. A real JPEG ABI mismatch
in the bundled qpdf build was fixed with isolated compiler paths and a retained
backup. Native acceptance creates six outputs, verifies original SHA256, checks
page pixels through dark/light/narrow layouts and quits cleanly. The scan fixture
shrinks from 5,609,204 to 953,676 bytes. The interface reviewer scores both named
interaction corrections resolved. See [PDF workbench](pdf-workbench.md).

Step 3 is complete: **Images for web…**, **Batch convert images…**, **PDF for
email…** and **Extract audio…** open editable, contextual export tools. Native
acceptance exercises all four commands and creates five outputs while preserving
sources. The scoped preset review returns ship. See [export presets](export-presets.md).

Step 4 is complete: the public reference corpus records real-file outcomes, including
bounded Office refusals and actual codec/RAW limits. It uncovered an unanswered
system-renderer request that also blocked shutdown; resource waits now time out
or cancel, ignore late bytes and drain. Media that decodes audio without a video
picture is labeled explicitly and falls back to a working audio player. The
complete suite passes **1,788 tests in 252 files**, with no failures or skips.
The full packaged-app smoke also passes. See [real-file qualification](real-file-qualification.md)
and [verification](verification.md) for final packaged evidence and limitations.

Every output preserves its original. Agent file removals remain subject to the
exact-path, explicit-approval and OS Trash requirements in AGENTS.md. Generated
fixtures and build artifacts remain retained.

The next completed step replaces eager XLSX worksheet trees with bounded ZIP and
XML streams. The public 18 MB worksheet that previously failed the 4 MB tree-part
limit now previews in the packaged app. Retained rows/cells remain bounded and
source-addressed; parsing, CRC validation and source-version checks continue
through the omitted suffix. Malformed tails, cancellation and changed sources
are covered by regression tests. The full suite now passes **1,800 tests in 255
files**. See [Office previews](office-previews.md) and the updated real-file record
for precise limits and retained acceptance evidence.
