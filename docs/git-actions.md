# Folder Git actions

The direct build exposes a **Git** submenu in folder/file actions and the same
commands in the command palette. These are explicit human actions. Background
badges remain opt-in under Settings → Browsing → Git; turning badges off does
not prevent an explicitly requested status or history command.

| Action                          | Behavior                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| Git status                      | Bounded short status and branch output                                                   |
| Git history                     | The most recent 100 commits, with date and subject                                       |
| Stage selection                 | Literal selected paths, within the current folder's repository                           |
| Stage all changes in repository | Additions, modifications and deletions across that repository                            |
| Commit staged changes…          | Multiline message dialog; commits only already staged changes                            |
| Pull · Fast-forward only        | Explicit configured upstream; no rebase, squash or autostash                             |
| Push upstream                   | Explicit current HEAD to the configured upstream branch; no force, mirror or follow-tags |

Actions resolve the repository containing the captured folder. A selected
subfolder does not silently change repository scope. Open it first to operate on
its repository. Push/pull require a usable configured upstream; configuring one
remains an explicit terminal operation in this version.

## Execution and results

The person's explicit command starts the action; Commit uses the app's message
form. The additional native Run alert has been removed. Ordinary repository
hooks, filters, signing programs and credential helpers can run; push/pull can
contact configured remotes. These changes have no Viewer file Undo.
Status/history use a separate hardened read
configuration with no hooks, fsmonitor, prompts, pager or network helpers.

Results open as linked Git terminal planes beside the originating folder. Input
is available to active mutation commands for interactive Git authentication or
signing; status/history reject input. Output and duration are bounded. Git
terminals retain their live output through culling. A command that finishes
before its plane mounts still retains initial output and exit status.

Saved/imported result panes contain only location and action-kind metadata. They
reopen dormant; they never replay commit/push/pull or start a fallback shell.
Commit messages, arguments, environment and credentials are not serialized into
the plane. Run a fresh action from the folder to create a new result.

## Ownership and enforcement

The renderer passes a fixed action kind and captured target, never an executable,
argv or environment. The desktop binds the request to its window/workspace and
checks the repository, branch, index/configuration and selected identities again
after asynchronous preparation. Canonical folder containment and actual
pane-to-root ownership are checked independently of the delayed discovery target.
Changed origins or repository state reject the request. Closing
the owner, revoking access or ejecting dependent storage cancels pending preparation
and drains owned processes. Mutations within one repository cannot race through
the private terminal lane.

Agent/model command discovery and recursive alias/sequence policy exclude these
program actions. Git terminal output is also unavailable to agent terminal-read
grants. Editable actions, imported configuration and saved grants cannot turn
these human commands into agent execution routes. Normal human terminal use
retains its configured shell/profile behavior.

Worktree inventory, branch snapshots and richer revision comparison remain
proposed in [spatial development](spatial-development.md). Implementation and
candidate-specific native acceptance are recorded separately in
[verification](verification.md).
