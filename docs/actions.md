# Actions and agents

Actions produce a proposal bound to the workspace, root, plane and files captured when invoked. Switching planes later does not retarget that task. Open them through a file's searchable context menu, Command-K, the native Actions menu or a recipe shortcut. Recipes can be edited, duplicated, imported and exported in Settings → Actions.

The manual file-rename dialog also offers **Rename actions…**. It lists applicable instruction, book and batch-rename recipes, retains the dialog's original target and opens the usual action setup. Choosing a recipe creates no file change by itself; its proposal still requires review and Apply.

## Publication naming

The default **Rename as book** template is:

```text
{year}, {authors}, {title}, {publisher}{extension}
```

For example, complete publication metadata can produce `2000, J. E. Rehder, The mastery and uses of fire in antiquity, McGill-Queen's University Press.epub`. Each field is separately evidenced. Local EPUB metadata works without a provider. PDF metadata, selectable text and bounded local macOS Vision OCR can supply model input for less structured books. File creation dates are never substituted for publication years. Missing or unproven fields leave an unchecked row for editing.

Select files or a folder, run the recipe, choose whether to include subfolders, and create the proposal. Review shows the editable filename first and the destination folder underneath. Edit path exposes the full destination when a folder change is needed. Expand Evidence to inspect the source text, edit names and select rows before Apply. Extensions stay intact; duplicate destinations, existing files, changed sources and paths escaping through symbolic links block application. Review is mandatory for both user- and agent-created proposals.

## Other recipes

- **Batch rename** needs no model. Prefix, suffix, literal replacement and `{name}`, `{extension}`, `{number}` templates are supported.
- **Rename with model** proposes a filename for each source.
- **Organize** proposes paths inside each source's existing parent. Required directories are created only during approved application.
- **Summarize** produces a read-only draft. Choose a new Markdown destination to create an export proposal, then review and Apply. Source identities are rechecked, including after restart.

Templates and instructions belong to the recipe, so repeat tasks do not require rewriting a prompt. A recipe's data mode is names, excerpts or bounded extracted text. Full-text mode still has extraction and request-size limits; it does not upload arbitrary original binaries.

## Models and permissions

Settings → Models has a provider picker for OpenAI, Anthropic, z.ai, DeepSeek, Qwen, Gemini, OpenRouter and local endpoints. Choose a provider, add its profile, save its API key and choose a model ID, then select that profile in a recipe. Model fields remain editable; Connect and load models offers discovered IDs where supported. OpenAI uses Responses, Anthropic uses structured tool output, and local servers need compatible structured JSON output. Discovery alone does not prove a model supports the required output.

| Provider   | Setup and output                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| z.ai       | Uses the [Z.ai Model API](https://docs.z.ai/guides/overview/quick-start), with published GLM suggestions or an entered model ID. It does not advertise a model-list connection. [JSON-object output](https://docs.z.ai/api-reference/llm/chat-completion) receives the proposal schema in its instructions.                                                                                     |
| DeepSeek   | Uses the [DeepSeek API](https://api-docs.deepseek.com/), with model discovery and [JSON-object output](https://api-docs.deepseek.com/api/create-chat-completion/).                                                                                                                                                                                                                              |
| Qwen       | Uses the [Alibaba Model Studio compatible API](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope). Match the endpoint to the API key's region; regional and workspace-specific endpoints are supported. Choose a model that supports [structured output in non-thinking mode](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output). |
| Gemini     | Uses Google's [OpenAI-compatible Gemini API](https://ai.google.dev/gemini-api/docs/openai), model discovery and structured JSON output.                                                                                                                                                                                                                                                         |
| OpenRouter | Uses [structured output](https://openrouter.ai/docs/guides/features/structured-outputs). Discovery filters models whose advertised parameters exclude structured outputs; routing requires providers that honor the requested parameters.                                                                                                                                                       |

All returned proposals pass the same local shape, evidence and scope validation before review, including providers that cannot enforce the schema themselves. Refused or truncated responses are rejected. Named cloud profiles use supported API hosts and do not forward credentials through redirects. Provider keys are encrypted through Electron's platform secure storage and written in mode-0600 metadata; renderers receive credential IDs rather than saved key values.

Every model-data request, including filename-only requests, requires explicit approval before transmission. Settings → Models and the action review disclose the provider endpoint and selected data level: names, excerpts or extracted text. `desktop/model-permissions.ts` stores that approval privately for the exact provider configuration; JSONC and Viewer’s agent API cannot grant it. Endpoint/kind changes, key removal and revocation invalidate consent and cancel requests. A legacy `allowContent` preference does not authorize sharing. Filename-only recipes do not extract document content. Local content indexing and model sharing remain separate permissions. OpenAI requests specify `store: false`; Viewer does not control provider retention of already transmitted information. No cloud provider/model is enabled by default.

## Apply, Undo and recovery

Applying requires the exact reviewed proposal revision and explicitly selected rows. The desktop service checks identity, size, modification time, destination scope and collisions; it serializes application with ordinary file jobs and publishes destinations exclusively. Source files are staged to permit cycles and case-only renames. Writes and progress are journaled before filesystem transitions.

Recipe Undo is offered for completed rename/move proposals whose destinations still match their recorded sources. Interrupted or partial recipe tasks show recorded paths and a recovery proposal. A changed source or occupied restoration path requires manual review. Summary exports do not have recipe Undo. Recipe Apply does not invoke Trash or overwrite. Ordinary file jobs separately support guarded Undo for copied/created outputs and native Viewer Trash receipts, documented in [release qualification](release-qualification.md).

Planning reads at most 2,000 selected/collected files, visits at most 100,000 directory entries and does not follow directory symlinks. Up to 100 tasks are retained. Local extraction is bounded to 150,000 characters; PDFs default to 16 sampled pages, EPUBs to 300 chapters, with compressed/expanded archive guards. Large batches can hit the metadata or provider-input limit and should be split.

## MCP

Settings → Agents enables the local server, grants folders and generates client configuration. The configuration contains a protected token: keep it private. This local token is stored in mode-0600 app metadata and does not use macOS Keychain. Browsing, previews, indexing and agent verification never access Keychain. Provider-key encryption uses it only when explicitly storing or using a provider key; locally rebuilt ad-hoc bundles can trigger renewed OS access prompts.

When updating from a build that encrypted its local agent token, generate fresh client configuration in Settings → Agents. The new local token has a separate storage file.

The packaged executable's `--mcp` mode is a headless stdio client for the running Viewer instance; that instance owns the index, proposals and user review. The Unix socket has mode 0600 in an owned mode-0700 temporary directory, avoiding macOS path-length limits.

The recipe tools remain `get_context`, `list_actions`, `read_metadata`, `search_files`, `run_action`, `get_task` and `cancel_task`. The shared command/configuration tools are `list_commands`, `explain_command`, `propose_command`, `read_config`, `validate_config`, `propose_config` and `get_proposal`; `read_terminal` requires a separate grant. Terminal input is unavailable. Canonical-path checks apply to file/terminal requests, including after permission revocation. Only tasks/proposals started by the current actor can be inspected. Settings → Agents can create named clients with separate tokens, folder roots, metadata/content/navigation/proposal/terminal-read capabilities and read/task budgets. Private storage retains client token hashes; credentials are shown only when created or rotated. Revocation immediately invalidates the credential. The compatibility token retains its existing shared roots and reviewed navigation behavior.

Navigation tools are `list_workspaces`, `list_planes`, `propose_open_path`, `propose_selection`, `propose_focus_plane` and `propose_workspace_switch`. Discovery reads the live published workspace catalog and omits inaccessible paths and history/layout. A named navigation capability permits navigation within that client's/native folder grants without another review. Compatibility-token requests still require review. Both paths recheck grants and stale origins/destinations, preserve independent versus linked plane ownership and can continue from an empty workspace. See [agent-navigation.md](agent-navigation.md) for arguments and the agent interaction sequence.

Named content clients can use `inspect_file`, `read_content` and `query_table` for
source-versioned facts, original passages and bounded CSV/TSV/XLSX windows. XLSX
accepts an optional exact `sheet` name and retains original sparse cell addresses;
formulas are never executed. See [Office previews](office-previews.md). File access
and client revision are checked again after reads; response budgets are enforced.
Metadata clients cannot obtain content by choosing a different tool.

`read_drawing_geometry` reads DXF through the same geometry reader as the viewer.
Arguments are `path`, optional `offset`/`limit` (at most 100 entities), `layer` and
`points`. Pages include source versions, the source-byte SHA-256, bounds, declared
units and available entity lengths/areas/radii. Unknown units remain unknown.
Coordinates represent the shared reader's 2D paths, including tessellated curves;
analytic measurements and approximation flags are separate. Point output is
limited to 2,000 coordinates and layers to 100 per response, with explicit paging
and truncation indicators. The reader does not infer a closed panel area from
unjoined line segments or union overlapping contours. Native/client grants and
returned-byte budgets apply. Other 3D geometry formats remain future agent tools.

`get_relationships` returns bounded receipt provenance and optional local
references. Both endpoints are permission-filtered; private reported notes and
commentary are excluded. Content scans additionally require a named content
capability. [Workflows and watch rules](workflows.md) compose the ordinary review
services; MCP cannot enable a watch approval or directly apply its file changes.

Command discovery filters the UI's captured catalog through the desktop agent safety policy. A command proposal opens review before invocation. Completion waits for the workspace acknowledgement or the actual file job outcome; failed/cancelled Trash jobs do not report success. Stopping the client cancels queued file removals. An already-running native Trash call may finish and remains recoverable. Origin changes or executor changes fail the proposal rather than retargeting it. Configuration proposals validate first, then apply a reviewed revision; they cannot change effective approvals. Recipe file changes still require their normal row review and Apply. No direct `apply`, `trash` or `delete` MCP tool is exposed.

Every agent command requires fresh user review, including custom built-in aliases. Settings → Agents lists each reviewed request's outcome (completed, failed, rejected or cancelled) with its title and items, alongside the tool calls.
Saved execution grants never suppress that review. Approving a command or
configuration proposal in the review panel is not enough: the desktop process
then shows its own system confirmation, and only its affirmative button runs the
request. A Trash request lists the exact paths, with each selected folder's item
count and size. The folder contents are pinned when the request is made, and any
later change inside them voids the approval; a folder with more than 10,000 items
must be moved to the Trash by the person. Its approval
cannot be replayed or reused for a later request. Changing the selected source or
custom action requires a new proposal. Source versions are checked again inside
the coordinated Trash operation; Trash failure never falls back to permanent
deletion. Existing Trash contents, granted roots, Home, disk roots, system folders and private Viewer data
cannot be trashed through the agent API.

Agents may propose only an allow-listed set of built-in commands that act on the
captured folder and selection, open a dialog the person completes, or change the
view (`domain/agent-safety.ts`). Paste and Move Here are refused because they act
on clipboard items outside the captured selection; new commands are refused until
they are added deliberately. Configuration proposals may change only presentation
and preview settings, folder views, recipes and saved searches: custom actions,
terminal profiles, shortcuts, agent access, providers, file-opening rules, search
scope, Trash confirmation and whole-section replacements stay with the person.
`read_config` redacts terminal environment values and shell scripts.

Agent shell scripts, executables, external-app commands, terminal profiles and terminal input are blocked
because they can bypass Trash. They are excluded from agent command discovery;
old clients and saved write/execution grants cannot re-enable them. Terminal
output reading remains separately granted. Agent file Undo is unavailable because it can remove outputs outside the captured selection; users can review it in Recent file operations. Human-invoked custom commands and
terminal use remain available in the app. A shell or executable action asks for a
system confirmation the first time each exact command runs, and again whenever it
changes, so an imported or externally edited configuration cannot run code
silently; confirmations are stored privately outside JSONC. A provider API key is
bound to the provider type and endpoint it was entered for and is not sent after
either changes. Effective grants stay outside JSONC;
imported configuration cannot authorize itself. Disabling Agents rejects further
requests and closes the server. Viewer must be running to supply context and
review UI. Coding agents also follow the repository's [removal policy](../AGENTS.md).

See [configuration.md](configuration.md) for declarative actions, placeholders and validation, and [terminals.md](terminals.md) for shell profiles and session behavior.

Provider protocol tests use synthetic responses; no live paid model or real user credential is used by verification. The native integration test exercises the packaged MCP client with an isolated profile and disposable book files.
