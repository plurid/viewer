# Custom actions and sequences

Use **Settings → Actions** to build a reusable action from an existing command, recipe, terminal
profile, literal executable arguments, explicit shell script or supported ordered workflow.

## Make it discoverable

Give the action a name and optional aliases. Choose a palette folder, pin it or set its order.
Context conditions restrict it to appropriate folders, target kinds, extensions and selection
counts. Matching uses the captured target rather than a later selection.

Actions appear in the contextual menu and **⌘K** when applicable. Manual recent commands can be
cleared. Saving a Run command draft opens Settings for explicit review; it does not immediately
install or rerun it.

## Ask for changing inputs

Text, number, choice and checkbox inputs become a form at invocation. Give them labels, defaults and
required status. Literal executable arguments retain each parameter as a distinct argument. Shell
scripts receive supported input values through their defined environment contract; they are not
naive text substitution.

## Run steps in order

An ordered sequence can combine supported commands/actions, such as Test → Build. Input definitions
are collected once; conflicting definitions are rejected. The next process step waits for the
previous outcome and failure stops progress.

The command language's `|` sequences actions; it is not a Unix pipe or a general typed output
connection. Sequences cannot recursively invoke themselves through custom commands. Use
[workflows](automation.md) when inspection outputs and reviewed file transformations need explicit
dependencies.

## Recipes and review

Built-in recipes cover publication naming, batch rename, model-assisted rename, organization and
summaries. Their proposal lists source files, proposed results, evidence and conflicts.
Include/exclude rows and inspect the preview before Apply. Naming templates and supported
deterministic rules can be reused without a model.

Model-backed recipes use the provider's explicit data permission. A model response does not mutate a
file by itself. Apply rechecks source identity/version and retains eligible guarded Undo.

## Execution and authority

The manual process form shows its captured folder and actual output. Cancellation stops owned work;
receipts retain bounded results. A working folder does not confine a shell to that directory.

New or changed executable/shell actions and terminal profiles require their exact native first-run
confirmation. Imported JSONC cannot approve itself. Agent commands require their own live
authorization and review; opaque process and terminal-input routes are not exposed as shortcuts
around Trash-only removal.

Configuration shapes are validated by the generated editor schema. See
[configuration](configuration.md), [terminals](terminals.md) and [agent integration](agents.md).
