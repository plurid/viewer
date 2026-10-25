# Quick export presets

Select files, open Commands and choose a preset. Each command opens the existing
tool with editable defaults. Files are created only after its explicit Export or
Optimize action. Outputs use the ordinary operation queue, collision handling,
cancellation and receipts; originals remain intact.

| Command               | ID                      | Defaults and review surface                                                                                                                                           |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images for web…       | `export.images-for-web` | Image tools: WebP, quality 80, maximum 2048 × 2048, keep aspect ratio, retain color/credit and remove GPS. Smaller inputs keep their dimensions.                      |
| Batch convert images… | `export.batch-convert`  | Image tools for two or more raster images: WebP, quality 85, original dimensions. Choose another format or dimensions before exporting.                               |
| PDF for email…        | `export.pdf-for-email`  | Optimize: Smaller, compatible JPEG scan recompression, maximum edge 1600px. Preserve text/vector pages; publish only if smaller. No target attachment-size guarantee. |
| Extract audio…        | `export.extract-audio`  | A fresh private media draft set to M4A/AAC. Review ranges and output name; choose Export each segment for separate files. A source without an audio track is refused. |

Commands appear only for compatible selections. Image/PDF batches support up to
1,000 inputs, media up to 16. Source versions are rechecked before output
publication. The media draft stays separate from any existing editing session.

The stable command IDs also work in Settings → Actions as built-in commands:
give them a preferred name, aliases, folder/extension conditions, shortcut, pin
and order. They can participate in command sequences. Their dialog choices apply
to that invocation. For a stored custom transform plan, use a reviewed conversion
workflow; these four built-in presets keep their documented defaults.

See [PDF tools and compression](pdf-workbench.md),
[configuration](configuration.md) and [spatial tools](spatial-tools.md).
