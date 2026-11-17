# Declared commands are typed lines

Status: accepted.

## Context

Folders already declare commands in package scripts, Makefile targets, justfile recipes, Procfile
entries and Deno tasks. Requiring people to copy those names into Viewer duplicates the source of
truth. Reading a declaration must not grant it execution authority.

## Decision

Show bounded declarations in **Run command…** and an empty `!` quick-command input. Group rows by
the literal file name, or relative path for a parent source, and show the line and body. Make
comments add context; Procfile details name the entry. A pick fills and focuses the input; the
person submits it through the existing manual command service. Run remains the one primary action.
No terminal-plane start, automatic execution or new agent command is introduced.

Pure parsers validate names, complete command lines and bodies. They cap file bytes, entries and
displayed detail. They never execute tools, evaluate syntax or follow includes. The desktop reads
nearest files toward the owning definition root, else a nearby Git root, else the folder itself.
Home and its ancestors never become roots. Package, just and Deno declarations use only the nearest
file of their kind. Parent Make targets use `make -C` with a relative folder; parent Procfiles are
excluded, so every offered line works from the captured folder.

`FolderFacts` owns a separate disposable worker thread, serial requests, interactive read priority,
150 ms deadlines and bounded pass relaunches. A timeout quarantines its `/Volumes` volume, or only
the stalled folder and descendants elsewhere, for 30 seconds. Two unreturned thread terminations
pause work on their mount and report a diagnostic until a thread stops. Known mount roots and volume
boundaries keep other mounts available. It reads regular files only and refuses links outside the
folder. Store reads borrow active scopes, recheck canonical results and cached source access, and
never request access. Folder history keeps its independent workers.

The desktop refuses declared-command requests from agents, agent-driven windows and non-workspace
windows. It checks the caller again after asynchronous discovery. Existing typed-line execution
authority, receipts and command cancellation remain unchanged.

After a successful manual start, the desktop re-derives declarations in the background without its
ten-second cache. A valid cached list skips known nonmatches; an expired or absent cache does not
prevent recording. Run replies without waiting for discovery or persistence. An exact line match
records a root-relative source, entry name and time under the root's real path. The private
`declared-commands-v1.json` uses `DocumentStore`, mode 0600, at most 200 roots and 1 MiB. This is
the single Last run store; found-workspace storage holds no command references. It is first written
for a recorded match. Unreadable data is kept aside; a failed preservation prevents overwriting it.
Clear recent folders clears references and invalidates overlapping record attempts; Undo does not
restore references. Failure to write either private store is reported without preventing the rest of
Clear. Backups, exports and agents receive none of this store. Declared text stays in memory; an
explicit run still creates its ordinary command receipt.

## Consequences and limits

Slow or failed discovery leaves an empty list and never blocks typing. A declaration is repository
content, not a sandbox or a guarantee of safety. Shell profiles, aliases, scripts and files can
change what an explicitly submitted line does. The person reviews and runs that line with their
normal shell authority. Saved actions, spoken plans and macros gain no discovery or execution
capability from this feature.

See [the terminal reference](../reference/terminals.md#declared-commands) and
[Run commands](../guides/develop.md#run-commands).
