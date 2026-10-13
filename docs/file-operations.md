# File operations and recovery

Ordinary file actions share one desktop operation queue. New folder, rename, duplicate, copy/move, native Trash, ZIP creation and archive extraction report progress through the operations popover. **Recent file operations** opens retained history from Commands or the File menu. A job can finish with some completed items and some errors; inspect both rather than assuming the whole selection succeeded.

## Transfers and conflicts

Selected descendants are carried by their selected parent once. Same-volume moves publish the original filesystem object with an exclusive rename. Copies and cross-volume moves stream through a private staging location; source identity, size and modification are checked before publication. A file appearing at the destination during the job is not silently overwritten.

Conflicts offer Skip, Keep both, Replace or Cancel. Replace moves the existing destination to native Trash before publishing the new item; it is a distinct mutation recorded in the receipt. Cancellation stops later work and cleans owned staging, while completed items remain visible in history. An unavailable source/destination permission stops the affected operation. In the Store edition, source and destination need their own applicable native grants; a JSONC path is not authorization.

On macOS, copying preserves modes, timestamps, xattrs, resource forks, ACLs and relative links through the native adapter. Unsupported metadata is reported as an error. Cross-volume move removal is restricted to the validated copied entries. If the source changes or removal fails, the completed destination and remaining original items are retained with an error. Same-volume rename/move and cross-volume copy/move have different recovery possibilities.

## Archives

**Compress as ZIP…** creates a ZIP outside the selected source trees. Creation accepts up to 20,000 entries and 2 GiB of input. Files stream into the staged output, so this limit does not imply loading the entire selection into memory. Source changes, unsupported special entries and conflicting archive names stop creation.

**Extract archive…** handles ZIP, TAR and TAR.GZ/TGZ. Each selected archive extracts into a named folder in the chosen destination, through private staging before publication. Limits are 20,000 entries, 32 MiB per file and 256 MiB total extracted contents; TAR/gzip parsing has its additional preview/decompression limits. Unsafe absolute/parent paths, Unicode/case name conflicts, encrypted entries, links and special entries are rejected. Extracted folders/files use private permissions (`0700`/`0600`); archive executable modes, timestamps and extended metadata are not restored. Extraction does not fetch remote assets or expand nested archives recursively. Archive previews remain read-only entry viewers; they do not extract files merely by opening an entry.

## Undo and restart

Command-Z and operation history offer Undo only when a durable receipt and current filesystem state make it eligible. Rename/same-volume move restore their original location; copied/created/archive outputs require an unchanged output tree; Viewer Trash receipts restore their recorded item. Changed output contents, occupied restoration paths, missing permissions or an output beyond the bounded proof budget can prevent Undo. Cross-volume moves currently have no application Undo. Layout arrangement Undo is separate from file Undo.

Receipts are written before filesystem transitions and retained in the private app profile. Completed eligible jobs can survive graceful Quit and relaunch. Interrupted mutations are retained with recovery paths for inspection; they are not replayed automatically, and an interrupted Undo is not offered again as though it completed. Preserve the original, destination and any reported staging/recovery path until their contents have been reviewed.

A terminal failure stores recovery paths separately from an in-flight mutation intent. Relaunch preserves its recorded status/errors and eligible Undo for successfully completed items; it does not relabel a known failure as an interrupted Undo. A final journal-save failure is reported even when the output copy completed, and the original and completed output are retained. Actual interrupted transitions still require inspection and are never replayed automatically.

The receipt history is bounded to 100 jobs, with up to 10,000 items in each bounded receipt array and a 16 MB metadata-document limit. It is an application recovery mechanism, not a backup or a general browser for all items in macOS Trash. Recipe proposals have their own reviewed recovery behavior, documented in [actions](actions.md).

## Qualification boundaries

Generated signed-runtime checks cover local metadata fidelity, native Trash receipts, cold restoration and owned-resource cleanup. Native low-space/interruption/provider failure, genuine separate picker roots and real Finder transfer intent remain release acceptance requirements. Full coordinated cloud/file-provider I/O is unfinished. See [release qualification](release-qualification.md) and the exact [native acceptance scenarios](release/native-acceptance.md) before making a distribution claim.
