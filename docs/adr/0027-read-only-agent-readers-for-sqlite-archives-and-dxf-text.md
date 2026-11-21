# Read-only agent readers for SQLite, archives and DXF text

Status: accepted. Date: 2026-11-21.

## Context

Agents could read text documents, spreadsheets and DXF geometry, but had no read-only way to inspect
SQLite databases, ZIP or TAR archive entries, or DXF `TEXT` and `MTEXT` labels. The owner approved
adding bounded, read-only readers for all three under the existing `content` capability and
untrusted-data boundaries.

## Decision

`src/desktop/agents/tool-catalog.ts` and `src/desktop/agents/agent-broker.ts` add `read_sqlite`,
`list_archive` and `read_archive_entry`, and include bounded `TEXT` and `MTEXT` strings in
`read_drawing_geometry`. Every call requires a named client with `content` capability, checks folder
grants and source versions before and after reading, and enforces the client's `maxReadBytes`
budget.

- `read_sqlite` runs through `FileServices.sqlite` (`src/desktop/files/file-services.ts`),
  `src/desktop/workers/preview-worker.ts` and `src/desktop/previews/sqlite.ts` under file
  coordination. It opens the database read-only and immutable without creating or reading `-wal`,
  `-shm` or journal files and without executing stored SQL, bounded by `sqliteLimits` in
  `src/domain/previews/data/sqlite.ts` (2 GB file cap, 500 objects, 100 columns, up to 200 rows per
  page).
- `list_archive` and `read_archive_entry` run through `FileServices.archiveList`,
  `FileServices.archiveReadText` and `src/desktop/previews/archives.ts` without extracting to disk.
  `list_archive` pages up to 500 entries from an index capped at 20,000 entries.
  `read_archive_entry` reads up to 262,144 bytes (default 65,536) of valid UTF-8 text trimmed
  cleanly at character boundaries, refusing unsafe paths, binary entries and private keys
  (`holdsPrivateKey` from `src/domain/previews/keys/certificates.ts`).
- `read_drawing_geometry` (`src/domain/previews/drawings/geometry.ts`) caps decoded `TEXT` and
  `MTEXT` values at 512 characters per entity, 50 text entities per page and 16,384 characters per
  page, marks truncation explicitly and adds a coverage note stating that entity text is untrusted
  file data, not instructions.

## Consequences

Named agents with content permission can inspect database schemas and row pages, archive contents
and drawing annotations without mutating files or extracting archives. Stored SQL never runs,
private keys and binary archive entries are refused, and returned text is explicitly marked as
untrusted file data.

See [Agents reference](../reference/agents.md).
