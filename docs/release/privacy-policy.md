# Viewer privacy policy — owner review draft

Prepared October 13, 2026. This document is ready for the publisher's factual review; it has not been published. Confirm the legal publisher, support address, effective date and public URL before submission. The signing account is Propal Invest SRL; that alone does not establish every legal/controller role.

Viewer is a file manager that runs on your Mac. Browsing, search indexing, previews, CAD conversion and workspace preferences run locally. Viewer has no advertising, analytics service or automatic upload of your files or diagnostic reports.

## Local files and application records

Viewer reads the files and folders you open or authorize. Its local records include workspace layouts, navigation history, configuration, search indexes, preview caches, action proposals and operation receipts. Receipts support review of interrupted operations and eligible Undo. These records can contain filenames, folder paths, file metadata and, when you enable content indexing or actions, extracted document text.

The Mac App Store edition uses macOS folder/file authorization. Permissions chosen in a native picker are saved privately and can survive relaunch. Clipboard and drag permissions last until Quit or revocation. Settings → Permissions lets you inspect and revoke these capabilities. Revocation stops affected work and clears related indexes and preview caches. Viewer does not restore revoked access by rereading an unchanged clipboard or drag selection. Selecting the items again in a new native copy/drag or granting them through the picker can authorize access again. A separately authorized parent folder can still provide access. The direct-download edition uses your ordinary macOS filesystem permissions.

Removing Viewer does not delete your original files. Application records can remain in macOS application storage after uninstalling. Do not delete these records while Viewer is running; back up records you want to retain first. Restoring a backup does not replace any native folder authorization that macOS requires.

## Optional model providers

Model actions are optional. They run only when you invoke an action and explicitly authorize the provider, endpoint and data level before transmission. The request includes your instructions and the data allowed for that recipe: filenames and extensions, or additional document metadata and excerpts/extracted text. Viewer bounds the transmitted evidence; approving extracted text does not mean every byte of an original file is uploaded.

Requests go directly from your Mac to the configured endpoint. Supported presets include OpenAI, Anthropic, z.ai, DeepSeek, Qwen, Gemini and OpenRouter; you can also configure an endpoint yourself. A local endpoint receives requests too. Your provider account, API key and endpoint determine which organization receives the request and how that organization treats it. Consult that provider's privacy and retention terms before allowing personal or confidential data.

Viewer saves your approval in a private permission document, separately from editable configuration. Editing JSONC or using Viewer’s agent API cannot grant this model-data permission. Changing the provider endpoint or clearing its API key invalidates the approval. Revoking access stops active requests and prevents future requests. Data already transmitted may remain with the provider; contact that provider to request deletion or exercise rights concerning its processing.

API keys are stored in a separate encrypted local credential document using macOS-backed encryption. They are not included in normal JSONC configuration exports. Providers may also receive ordinary network metadata, such as your IP address, when you connect or make a request.

## Local agents, commands and terminal applications

Agent access is disabled until you enable it. Connected local agents authenticate with a private token and use the roots/capabilities you permit. Agents share the configured local access set in this version. Review which client receives your connection information and revoke approvals you no longer need.

Custom commands, embedded terminals and external terminal handoffs run when invoked. A process, connected agent or external application can read or transmit information under its own permissions and policies. Its working directory is not a security boundary. Viewer does not control data that you instruct another application or executable to process.

## Support and distribution

If you contact source@plurid.com, support receives only the information you choose to send. Screenshots, logs and exported configuration can contain personal paths or document names; redact information you do not want to share. Viewer does not automatically send these reports.

Apple handles Mac App Store downloads, transactions and any diagnostics you choose to share with Apple under Apple's own terms. A direct download may be notarized by Apple as part of distribution; notarization concerns the application bundle rather than your working files.

## Contact and changes

Questions about Viewer can be sent to source@plurid.com. Questions about data already sent to a model provider should also go to that provider. Publish the effective date and describe material changes when updating this policy.

Publisher review must reconcile this policy with the final binary, App Store privacy answers, enabled third-party services and applicable legal obligations. Do not select “Data Not Collected” solely because Viewer has no analytics: user-configured model providers must be assessed too. [Apple App Privacy guidance](https://developer.apple.com/app-store/app-privacy-details/).
