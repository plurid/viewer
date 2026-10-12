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

| Provider | Setup and output |
| --- | --- |
| z.ai | Uses the [Z.ai Model API](https://docs.z.ai/guides/overview/quick-start), with published GLM suggestions or an entered model ID. It does not advertise a model-list connection. [JSON-object output](https://docs.z.ai/api-reference/llm/chat-completion) receives the proposal schema in its instructions. |
| DeepSeek | Uses the [DeepSeek API](https://api-docs.deepseek.com/), with model discovery and [JSON-object output](https://api-docs.deepseek.com/api/create-chat-completion/). |
| Qwen | Uses the [Alibaba Model Studio compatible API](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope). Match the endpoint to the API key's region; regional and workspace-specific endpoints are supported. Choose a model that supports [structured output in non-thinking mode](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output). |
| Gemini | Uses Google's [OpenAI-compatible Gemini API](https://ai.google.dev/gemini-api/docs/openai), model discovery and structured JSON output. |
| OpenRouter | Uses [structured output](https://openrouter.ai/docs/guides/features/structured-outputs). Discovery filters models whose advertised parameters exclude structured outputs; routing requires providers that honor the requested parameters. |

All returned proposals pass the same local shape, evidence and scope validation before review, including providers that cannot enforce the schema themselves. Refused or truncated responses are rejected. Named cloud profiles use supported API hosts and do not forward credentials through redirects. Provider keys are encrypted through Electron's platform secure storage and written in mode-0600 metadata; renderers receive credential IDs rather than saved key values.

Document text may leave the device only when the selected provider permits document content and the recipe asks for it. Filename-only recipes do not extract content. Document-content indexing and model text sharing are separate permissions. OpenAI requests specify `store: false`; the app does not control the provider's wider data policy. No cloud provider or model is enabled by default.

## Apply, Undo and recovery

Applying requires the exact reviewed proposal revision and explicitly selected rows. The desktop service checks identity, size, modification time, destination scope and collisions; it serializes application with ordinary file jobs and publishes destinations exclusively. Source files are staged to permit cycles and case-only renames. Writes and progress are journaled before filesystem transitions.

Undo is offered for completed rename/move proposals whose destinations still match their recorded sources. Interrupted or partial tasks show recorded paths and a recovery proposal. A changed source or occupied restoration path requires manual review. Summary exports and ordinary copies do not have application Undo. None of these actions invokes Trash or overwrite.

Planning reads at most 2,000 selected/collected files, visits at most 100,000 directory entries and does not follow directory symlinks. Up to 100 tasks are retained. Local extraction is bounded to 150,000 characters; PDFs default to 16 sampled pages, EPUBs to 300 chapters, with compressed/expanded archive guards. Large batches can hit the metadata or provider-input limit and should be split.

## MCP

Settings → Agents enables the local server, grants folders and generates client configuration. The configuration contains a protected token: keep it private. This local token is stored in mode-0600 app metadata and does not use macOS Keychain. Browsing, previews, indexing and agent verification never access Keychain. Provider-key encryption uses it only when explicitly storing or using a provider key; locally rebuilt ad-hoc bundles can trigger renewed OS access prompts.

When updating from a build that encrypted its local agent token, generate fresh client configuration in Settings → Agents. The new local token has a separate storage file.

The packaged executable's `--mcp` mode is a headless stdio client for the running Viewer instance; that instance owns the index, proposals and user review. The Unix socket has mode 0600 in an owned mode-0700 temporary directory, avoiding macOS path-length limits.

The recipe tools remain `get_context`, `list_actions`, `read_metadata`, `search_files`, `run_action`, `get_task` and `cancel_task`. The shared command/configuration tools are `list_commands`, `explain_command`, `propose_command`, `read_config`, `validate_config`, `propose_config` and `get_proposal`; terminal tools are `read_terminal` and `write_terminal`. Canonical-path checks apply to file/terminal requests, including after permission revocation. Only tasks/proposals started by the current token can be inspected. Rotating the token disconnects current clients. Clients sharing one token share its folder grants; separate per-client grants are future work.

Command discovery uses the same captured context, availability and IDs as the UI. A command proposal opens review before invocation, and completion waits for the workspace acknowledgement or a subprocess's final status. Origin changes or executor changes fail the proposal rather than retargeting it. Configuration proposals validate first, then apply a reviewed revision; they cannot change effective approvals. Recipe file changes still require their normal row review and Apply. No direct `apply`, `trash` or `delete` MCP tool is exposed.

Settings → Agents can explicitly grant unattended execution to an exact custom-action definition in a canonical folder. Editing that action invalidates its grant. Terminal output reading and input writing use separate grants. Effective grants are stored outside JSONC; imported configuration cannot authorize itself. Custom executables, shell scripts and terminal input have the user's OS permissions: their working directory is not a sandbox. Arbitrary command mutations do not acquire the operation service's Undo. Disabling Agents rejects further requests and closes the server; enabling it starts the local server live. Viewer must be running to supply context and review UI.

See [configuration.md](configuration.md) for declarative actions, placeholders and validation, and [terminals.md](terminals.md) for shell profiles and session behavior.

Provider protocol tests use synthetic responses; no live paid model or real user credential is used by verification. The native integration test exercises the packaged MCP client with an isolated profile and disposable book files.
