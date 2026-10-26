# Spatial development and review

The aim is to keep the code, evidence and conversation around a task visible together. Space earns
its place when it reduces context switching or explains a relationship. Ordinary editing and
browsing still work in a docked view.

## Foundation already available

Worktrees provide separate editable branch folders; planes provide views of them. Multiple views can
share one checkout. Tasks retain notes/tools, Git review has chosen bases and hunks, and external
adapters can report sessions explicitly. See [tasks and Git](../reference/tasks-and-git.md) for
current behavior.

## Further ideas

| Direction                   | Useful result                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Read-only revision folders  | Browse a branch/commit without creating another editable checkout                                |
| Branch work areas           | Move between alternative implementations and their evidence with stable landmarks                |
| Review paths                | Follow changed files, tests and discussion as an ordered route through a change                  |
| Comparison rooms            | Keep base, alternatives, behavior and outputs visible together                                   |
| Semantic zoom               | Reveal summaries from a distance and full file controls when approaching                         |
| Linked arrangements         | Keep related tools in a useful formation while retaining manual placement                        |
| Conversation forks          | Associate each branch of a discussion with the checkout and source versions it used              |
| Attention cues              | Show a genuine reported need for review without interrupting unrelated work                      |
| Context receipts            | Record the exact sources and versions an agent inspected, plus citations and limits              |
| Living project intent       | Keep small, current assumptions and constraints beside implementation evidence                   |
| Patch provenance            | Preserve a historical patch when a discussion refers to it, instead of linking only current HEAD |
| Agent adapters              | Navigate actual external sessions and explicit lifecycle/status events                           |
| Dependency and result views | Connect inputs, processes, derived assets and their verification                                 |

## Integration choices

A Codex/Claude CLI can run in a terminal. Structured transcript navigation needs a separate adapter;
terminal escape sequences are not a conversation protocol. Prefer reported events and explicit
source links to parsing a changing private transcript format or guessing progress from process
output.

An editable branch needs a real worktree. A read-only revision browser needs a different resource
source and capabilities. Do not hide a checkout operation inside a camera or view change. Worktree
cleanup must respect its files and the repository removal policy independently of closing views.

## Architecture questions

Extend the existing workspace, resource, task, session and operation owners. Keep terminal
processes, agent sessions, browser pages and documents separate from view IDs. Resource limits,
culling, reconnects and cold restoration need meaningful behavior before a large arrangement becomes
a useful workspace.

Proximity does not grant authority. Opening a plane beside another does not grant its agent the
other folder, authenticated browser session or shell input. Context receipts provide evidence, not
permission or proof that a model followed every instruction.

## References behind the direction

The original discussion compared IDE integration, worktree-based harnesses and agent review, and
drew on TrenchBroom's direct spatial workflow. The lesson is to make relationships directly usable
rather than render flat tabs in 3D. These comparisons inform product questions; they do not
establish equivalent capabilities or endorse predictions about another product's future.
