# Composable actions and a configurable command palette

Product proposal, October 24, 2026. Requested alongside
[spatial development](spatial-development.md) and the [Journal plane](journal-plane.md).
The builder, palette folders and directory predicates below are proposed, not shipped.

## Build on the existing system

Viewer already has a shared command registry, contextual menus, shortcuts,
custom built-in/recipe/terminal/executable/shell actions, recorded macros, named
command sequences, a command language and portable workflows. Custom actions
already have aliases, icons, order, pinning and selection/extension predicates.
Workflows already support inspection, comparison, recipes, reviewed copy,
dependencies, source versions and run receipts.

See [actions](actions.md), [configuration](configuration.md),
[command language](command-line.md) and [workflows](workflows.md). The opportunity
is to make these capabilities easier to compose, discover and inspect, rather
than introducing another execution engine or a second command catalog.

## One command, several ways to invoke it

A command needs a stable ID independent of its name, aliases and placement. The
palette, folder menu, shortcut, toolbar and permitted agent proposal resolve the
same command definition and availability rules. Changing presentation must not
change execution semantics or authority.

Keep these concepts distinct:

| Concept      | Role                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| Definition   | What an action does, its input/output shape and declared effects       |
| Invocation   | Captured workspace/plane/directory/selection and transient user inputs |
| Placement    | Palette group/folder, order, pin, shortcut and visibility preference   |
| Availability | Where the action is relevant and whether required inputs exist         |
| Authority    | What native, provider and agent permissions actually allow             |
| Run          | A bounded execution with progress, output, cancellation and receipts   |

A hidden command is not secured. A visible command is not authorized. These
distinctions must hold for aliases, nested compositions, imported projects and
agent discovery too.

## An action builder

Provide **Create action…**, **Edit action…** and **Duplicate action…**. Begin with
three clear choices: Viewer command, program, or reviewed model recipe. Offer a
step-by-step composition only when more than one action is needed.

The editor should show name, description, icon, inputs, availability and placement,
then the actual steps and their expected effects. Include a readable summary:
“Inspect selected PDFs, ask a model for publication names, then open Rename review.”
Preserve advanced JSONC editing with the same versioned validation and diagnostics.

### Typed input forms

Actions can ask for text, a multiline message, number, boolean, enum, file/folder
reference or an explicit selection. Show defaults, constraints and help in the
palette's action detail view or an appropriate dialog. Validate before running.
Do not force meaningful forms into a tiny search row.

Use a bounded declarative schema subset. Imported schemas cannot run scripts,
fetch remote references, render arbitrary HTML or create unbounded forms. Secrets
use a private credential reference or transient secret input, never a saved
default, history entry, journal field or plain environment dump.

### Compose outputs explicitly

An action can use:

- Existing Viewer commands, when their current contract supports the required input.
- Read-only metadata/content inspection within approved scope.
- A provider-backed structured result, under endpoint/data consent.
- A program with literal argument values, or an explicitly chosen shell script.
- An existing workflow or reviewed mutation proposal.
- A result presentation: table, scratch document, preview, diff or bounded log.

Do not describe the existing command language's `|` as a data pipe: it sequences
commands today. Data-bearing compositions need typed references to declared
inputs and completed step artifacts, reusing workflow concepts. No hidden string
substitution between loosely related commands.

Start with sequential dependencies and stop-on-error behavior. Validate missing
references, cycles and unsupported steps before running. Add branching or
parallelism only when a real workflow needs it and its cancellation/failure rules
are explicit. Bound depth, fan-out, output bytes and elapsed work.

## Structured model and program output

A model can produce a schema-validated table, extracted facts, suggested names,
an outline or a proposed command. Store provider attribution and the source
versions. Unsupported, truncated or malformed output fails locally. Schema-valid
output can still be wrong; keep evidence and human review where consequences matter.

Example:

```text
Selected invoices
  → read approved bounded metadata/excerpts
  → model returns { invoiceNumber, date, suggestedName, evidence }
  → validate source identities, values and destination names
  → editable rename review
  → explicit Apply through the existing operation service
```

A person may also wrap a program such as a test runner or converter in a named
action. Give it a normal input form and progress/result UI. Prefer executable
plus literal argv; shell syntax must be an explicit mode with its actual script
reviewed. Inputs, paths and model-generated strings do not become shell source.
Use a PTY only when interaction is needed; a bounded background program can have
a simple output/status plane.

For a JSON-output program, validate its stdout separately from exit status and
stderr. A successful exit does not prove a valid artifact. A returned filename,
URL or proposed command is untrusted data and cannot widen the captured scope.
Normal terminal commands remain available to the person, but a nice palette row
does not make an opaque program safe for an agent.

Mutation steps retain the existing review, identity checks, native confirmation
where required and eligible Undo rules. Git push, arbitrary programs and external
side effects are not automatically reversible. Do not offer an invented atomic
Undo for a composition that already performed such work.

## Contextual actions

Extend the existing selection predicates with explicit directory/project context:
an exact folder, descendants of a named folder binding, a supported project type,
or an appropriate plane type. Examples: Show tests only for a project folder;
offer an invoice recipe only in Accounts; show image tools only for usable images.

Directory matching needs a defined basis. Keep literal folders and portable
project bindings separate from wildcard patterns. Specify descendant behavior,
case handling and symlinks. Prefer canonical identities for consequential action
scope, not a string prefix that also matches a sibling folder name.

The renderer uses these rules for discovery. The desktop rechecks actual scope,
source versions, executor revision and permissions after an asynchronous review.
An action cannot target a new folder just because the active plane changed.
Invalid, missing or inaccessible bindings produce diagnostics and no execution.
Availability never grants filesystem, provider or agent access.

## A palette the user can organize

Allow user-created command folders/groups such as Development, Publishing and
Personal, with explicit order, pins, aliases and contextual placement. One command
can appear in several groups without becoming several executors. A group is a
palette organization record, not an on-disk directory.

Keep global search across applicable commands, with group/path breadcrumbs on
results. Provide a way to search the complete catalog and reset presentation so
an accidental hide does not make core commands unreachable. Never silently move
a destructive command into a harmless action's identity or rename away its effect.

Use personal defaults plus explicit project/workspace presentation overlays.
Imported layout/placement records are dormant preferences, not executable grants.
Missing command IDs remain visible in the editor as unresolved references; do
not silently substitute similarly named actions. Store stable IDs and migrate
definition versions instead of using labels as foreign keys.

Begin with groups, order and pins; keep nested group depth small and validate
cycles. Existing `:`, `>` and settings modes retain their meanings. Keyboard
search should stay fast without requiring someone to browse a folder tree.

## Agent integration

An agent can propose a permitted command or a draft composition, with a readable
preview. It cannot author itself executable authority through custom definitions,
palette configuration or structured output. Existing denials of opaque programs,
shells, terminal input and Git program actions remain in force recursively.

Compute effective capabilities over the whole composition, including aliases and
dependencies. Review must name consequential steps; approving a harmless read
cannot approve a later shell or file removal. Editable configuration and imported
JSONC never substitute for private consent. Agent removal still requires exact
native-reviewed paths and OS Trash, with no permanent-deletion fallback.

## Runs, Journal and spatial results

Each run has a captured origin, definition revision, input references, step state,
bounded artifact references and observed outcomes. Emit safe lifecycle events to
Journal under one correlation ID. Open a result plane linked to the invoking
folder or work area when useful. Do not spawn a plane for every internal step.

User input, credentials, source text and raw program arguments do not belong in
the general event log. Links to private artifacts still enforce access. Paused,
failed and disconnected runs are explicit; reopening a result cannot replay the
action. Retrying a mutation requires checking its prior outcome and current state.

## Delivery sequence

1. Improve existing custom-action editing and palette groups/pins without changing
   executors or authority. Show a preview of where an action will appear.
2. Add directory/project predicates and consistent desktop revalidation.
3. Add typed input forms to a small set of existing executors.
4. Expose existing workflow inspection and reviewed recipe steps in a visual builder.
5. Add versioned typed artifact references and supported output presentations.
6. Integrate safe Journal events, shared attention and optional agent-authored drafts.

Acceptance includes filenames with shell characters, Unicode and spaces;
multi-window/workspace changes during review; invalid bindings; missing commands;
imported definitions; malformed structured output; partial failure; cancellation;
restoration without execution; and nested aliases trying to cross agent policy.
Measure palette search with a large catalog. Test complete workflows rather than
only whether a schema or form renders.
