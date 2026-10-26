# Git worktrees

Implemented October 25, 2026. This is the first worktree stage from
[spatial development](spatial-development.md#delivery-sequence).

## Open a checkout beside another

In a repository folder, run **Open worktree…** from Commands or the folder's Git
menu. Search registered checkouts by branch or path, inspect the selected
checkout's change count, and choose **Open beside**. Viewer places its folder
beside the originating folder using the existing spatial split geometry. Other
planes keep their arrangements.

If that exact checkout folder is already displayed, **Show existing plane**
returns to it. **Another view beside** creates a new plane with its own identity,
navigation and selection. Multiple views of one checkout share the same files
and staging index; different worktrees have separate working files and indices.
These are ordinary folder planes, so existing terminal, preview, local-server and
file commands keep their usual filesystem context.

**Show Git status in folder planes** uses the existing shared opt-in preference.
Discovery and the selected checkout's explicit status read work independently of
that preference. Automatic folder badges and branch/change-count headers remain
off until the user enables them. Headers show the actual checkout's current
branch, ahead/behind counts and Clean or its changed-path count.

Clicking the branch header opens a linked Git changes plane. **Open diff** links
the editable comparison beneath that changes plane. Closing a comparison returns
to its parent. HEAD bytes retain their exact commit source; working bytes remain
the selected checkout's local file. Folder paths, independent navigation and
spatial links/placements restore through the existing workspace persistence.
Restoration never checks out a branch or recreates a missing worktree.

## Identity and authority

`domain/comparison/worktrees.ts` parses NUL-delimited Git registry output and
defines the typed requests/replies. Newlines and spaces in paths stay literal;
unknown, repeated, malformed and oversized records fail closed. Discovery is
capped at 256 worktrees and the existing Git runner's output/time budgets.

`desktop/comparison/worktrees.ts` owns a dedicated explicit-read `GitReader`,
separate from the optional background badge reader. It uses the same hardened
Git runner: no shell, hooks, fsmonitor, prompts, optional index writes, lazy
network fetch or configured transport. The direct-build check happens before
filesystem access or executable probing. No new dependency is introduced.

Discovery captures ordinary checkout-directory identity, Git administration
identity, a bounded Git-pointer fingerprint and shared-repository identity.
Inspect/open re-read registration and verify branch, revision, folder and
administration identities, including the checkout's current shared repository.
Changes require Refresh. Reading does not freeze external Git/filesystem changes;
the verification records what was observed before opening.

Catalogs are opaque, owner-bound leases, expire after five minutes and remain
bounded to sixteen in memory. Requests are limited to sixteen pending reads.
Source windows and renderer opening context are checked before applying a result.
A result for an old folder/workspace cannot open a plane in its replacement.
Closing the picker releases its lease; restart discards all discovery leases.

Bare, detached, unborn, locked and prunable registrations have explicit states.
Bare/missing/inaccessible/prunable checkouts cannot open as editable folder views.
A registration lock preserves ordinary browsing/editing. Unexpected folder or
Git-pointer links/replacements are refused. There is no raw Git-argument route,
MCP worktree reader or agent-proposable worktree command.

The API exposes **list**, **inspect**, **open**, **create** and **release**.
Creation is a separate human-only typed operation; no caller supplies Git arguments.
There is no force, switch, stash, reset, prune or removal operation. Closing a
plane changes its view state; its checkout and Git registration stay on disk.

## Verification

Fourteen added cases cover parser bounds, two real checkouts, hook/index/ref
preservation, owner/expiry isolation, changed branches/replaced directories,
locked/missing states, unavailable builds, picker behavior, independent view
navigation, stale openings and linked comparisons. Existing Git and spatial
regressions pass as part of the complete suite.

Packaged native acceptance discovers `main` and `feature`, shows independent
Clean/2 changes headers, opens them beside each other, opens a second view of
`feature`, reads a changed working file in an editable linked diff, and restores
the views after a cold restart. Main-file contents, both index hashes and shared
refs remain unchanged. Fixture files and every generated checkout are retained.
See [verification](verification.md) for the exact candidate, commands and reports.


## Create another checkout

Choose **Create worktree…** inside the existing picker. **New branch** names a
branch and selects a local base pinned to the displayed commit. **Existing branch**
chooses an unused local branch. A checked-out branch offers **Show worktree**
instead of forcing a duplicate. The suggested destination is a sibling of the
main repository, with the branch name as a suffix; edit it or choose another
parent folder. The destination must not exist, including as a symlink.

**Create and open** invokes a fixed `git worktree add` and verifies the resulting
branch, revision and shared repository. It opens a folder beside the source and
links a Git changes plane beneath it. A terminal remains a separate explicit
action. Worktree listing remains independent of automatic Git badge preferences;
the existing changes plane uses the configured Git preference.

Creation rechecks the captured folder/window/workspace, catalog ownership,
source/admin identities, pinned refs, canonical parent identity and file access.
Local branch discovery is bounded to 512 branches. Writes serialize by repository,
allow up to 256 KiB diagnostics and stop after 120 seconds, on owner closure or
access revocation. The process uses ordinary repository hooks and filters; its
fixed argv has no shell or force option. No network operation is requested, though
configured Git programs keep ordinary human-invoked Git behavior. Errors identify
the destination and preserve any files/branch created by Git for inspection.
Viewer never runs worktree cleanup. Catalogs and references must be refreshed when
a branch, registration or checkout changes.

`tests/worktree-creation.test.ts` covers real new/existing branches, normal hooks,
source preservation, occupied/stale/foreign selections, parent links, cancellation,
concurrency and retained partial outputs. `tests/native/worktree-creation.ts`
creates both branches through the packaged UI, verifies linked folder/Git views,
source/index hashes and cold restoration. See the implementation ledger and
verification record for the exact candidate and captures.
