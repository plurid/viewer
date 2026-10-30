# PDF tools

This page lists what **PDF tools…** and **Optimize…** do to PDFs, their controls and their limits.

Select up to 16 PDFs and choose **PDF tools…** in **⌘K**, or press **PDF tools…** in a PDF preview.
The page list is the output plan; the preview shows the selected source page.

## Assemble pages

| Task    | Control                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Extract | Choose the **Source PDF**, type a range in **Pages to include**, such as `1-3, 8, 5`, then **Apply range** |
| Merge   | Select several PDFs, or use **Add PDFs…**, then arrange their pages                                        |
| Reorder | Select a page, then **Move page up** or **Move page down**                                                 |
| Rotate  | Select a page, then **Rotate page clockwise** (90° each press)                                             |
| Include | Tick each page, or use **Include all** and **Clear selection**                                             |
| Split   | Tick **Save each included page separately**, then **Split pages**                                          |

- A range keeps the order you type; `5-1` runs backwards. A page named twice is included once.
- **Save PDF** writes one file under the name and folder you choose. **Split pages** writes
  `Name 001.pdf`, `Name 002.pdf` and so on.
- Page text, vectors and page geometry are kept. A new document does not keep document bookmarks,
  interactive forms or accessibility tags.
- Signed and encrypted PDFs are refused; use an unsigned, unlocked copy.
- **Cancel export** stops further work; outputs already completed stay.

| Limit               | Value                |
| ------------------- | -------------------- |
| Source PDFs         | 16                   |
| Pages per output    | 1,000                |
| Pages in all inputs | 1,000                |
| One source          | 256 MB               |
| All sources         | 512 MB               |
| Split run           | 100 output files     |
| Time                | 3 minutes per output |

## Optimize

Choose **Optimize…** for smaller copies. The originals stay as they were; each copy is named
`Name optimized.pdf`. [Media](media.md#optimize) describes the shared dialog, review and target
sizes.

| Preset                             | Effect on a PDF                                            |
| ---------------------------------- | ---------------------------------------------------------- |
| **Lossless · keep image pixels**   | Compresses the structure and streams; images are unchanged |
| **Balanced · high quality**        | Also re-encodes eligible images as JPEG at quality 85      |
| **Smaller · stronger compression** | Also re-encodes eligible images as JPEG at quality 65      |

**Recompress scanned images** (Balanced and Smaller only) re-encodes compatible 8-bit RGB and
grayscale JPEG images, existing JPEG scans included, at the preset's quality and at most the **PDF
maximum image edge**: 256 to 8,192 px, 2,400 by default. Unusual color spaces, masks and other
encodings stay as they are. Text and vectors are kept; pages are never flattened to pictures.

- A copy is saved only when it is smaller; otherwise the row says **Already compact · original
  kept**.
- Signed and encrypted PDFs are refused.
- There is no OCR, and no target size is guaranteed.

| Limit                   | Value             |
| ----------------------- | ----------------- |
| One PDF                 | 256 MB            |
| Scanned images replaced | 500 per PDF       |
| Replacement image data  | 48 MB             |
| Time                    | 3 minutes per PDF |

**PDF for email…** starts with **Smaller**, scan recompression and a 1,600 px maximum edge. Review
those choices before exporting.

## How the output is made

Bundled qpdf assembles pages and writes object updates; the bundled image processor re-encodes
images. Each output comes from a checked plan with fixed arguments, and source versions are checked
again before the output is published. Outputs are new files with Undo, reported in **File
operations**.

**Related:** [Make a quick change](../guides/create.md#rearrange-a-pdf) ·
[Lay out photos and PDFs](../guides/layout.md) · [Media and Optimize](media.md) ·
[Layout output](layout.md) · [File operations](file-operations.md)
