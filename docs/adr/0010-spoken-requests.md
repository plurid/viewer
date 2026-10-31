# Spoken requests

## Decision

A spoken request is Ask Viewer by voice. Its transcript is data, as a document's text is: its only
authority is to pick commands from the registry where the person spoke.
`domain/command-line/spoken.ts` checks every plan against the commands offered on the target
captured when the recording began, whether Ask Viewer's model wrote it at the `names` level or
Viewer matched the words to command labels and aliases itself. Nothing free-form runs.

A step runs at once only when its command is on a short list of commands that change no file: they
show, select, arrange or check. Every other command waits for the person's press, a command added
later included. What a model may never put in a line, such as a terminal or emptying the Trash, is
refused.

A command describes itself to a plan through `spoken` on its definition: the phrase the plan says,
what it acts on, the commands it follows and a run that resolves once its work is done. The registry
runs each step with the checks it gives any command, so a spoken request has no executor of its own.

## Consequences

"Check this job and prepare the cut sheets" runs without a review. A misheard request can at worst
run a command that only shows, selects or checks, at the data level the person already allowed for
its model. The panel shows the words and the plan before and while the steps run.

Audio consent, model data permission and agent grants keep their owners; a spoken request changes
none of them. Agents cannot start one. A check waits for its own permission when its model may not
receive pictures, and a request naming a target that is not there runs only on a press.
