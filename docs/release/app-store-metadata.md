# App Store submission draft

Prepared October 13, 2026. No listing has been created or submitted by this qualification pass.
Resolve every release gate before using these drafts publicly.

| Field                            | Proposed value / owner decision                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| App name                         | Viewer                                                                                                  |
| Subtitle                         | Files in a spatial workspace                                                                            |
| Bundle identifier                | `com.pluridviewer.app`                                                                                  |
| Team                             | Propal Invest SRL, `49W9L8Z9J5`                                                                         |
| Version                          | `1.0.0`; final Store build number must be unique                                                        |
| Primary category                 | Utilities                                                                                               |
| Initial platform                 | macOS, Apple Silicon, minimum macOS 14                                                                  |
| SKU                              | `viewer-macos-001` (confirm uniqueness in App Store Connect)                                            |
| Keywords                         | `files,folders,workspace,preview,CAD,DXF,STEP,STL,terminal,AI,search`                                   |
| Support contact                  | `source@plurid.com` (owner must confirm monitoring)                                                     |
| Support / privacy URLs           | Publish and verify the reviewed drafts at stable HTTPS URLs; do not submit placeholder URLs             |
| Copyright / price / availability | Publisher decision; do not infer from the signing Team ID                                               |
| Age rating                       | Complete the current questionnaire using actual optional AI, external links and executable capabilities |
| Export compliance                | Publisher declaration based on the final binary's cryptography; do not infer from local signing success |

## Description draft

Explore your files in a workspace that grows with your work.

Viewer combines ordinary folder browsing with spatial planes for folders, previews and terminals.
Keep related files side by side, switch workspaces from Command-K, and give each folder its own
view.

- Browse with List, Grid, Columns, Gallery and Map, configurable fields and resizable columns.
- Search folders and invoke grouped context actions without losing your place.
- Preview documents, images, media, data and common CAD models locally. Inspect DXF drawings with
  measurements, or orbit supported 3D models in a plane.
- Copy, move, rename, create archives and extract supported archives with progress, conflict choices
  and eligible Undo.
- Configure terminal profiles and your own contextual commands. Optional local agent access works
  through reviewed capabilities.
- Connect an optional model provider for reviewed rename, organization and summary actions. Choose
  the endpoint and explicitly approve the data before it is sent.
- Edit a commented JSONC configuration through Settings or your preferred editor.

Viewer's core browsing and local previews do not require a Viewer account. Model actions require
your own compatible provider setup and may involve provider charges. Complex or unsupported files
have visible limits; CAD measurements use rendered geometry and are not a replacement for
manufacturing validation.

## Review notes draft

Viewer is a sandboxed file manager. On first use, an ungranted folder shows **Allow folder
access…**; choose a generated folder to authorize it. The app deliberately denies arbitrary
filesystem paths without a native grant. Settings → Permissions manages saved and session
permissions.

Core browsing, supported previews and local recipe actions work without a cloud account. To test
optional cloud actions, configure a compatible provider in Models and explicitly authorize its
endpoint and data level. Filenames require approval too. The review environment should not transmit
private review files. Configuration edits and agent requests cannot grant model-data consent;
changing the endpoint or clearing the key invalidates consent.

File mutations show progress and conflict choices. Action proposals open for review before applying.
Undo is offered only when receipts and output identity make it eligible. Interrupted work is kept
for inspection and never replayed automatically.

Embedded terminals and user commands are intentional product capabilities. External terminal
handoffs use application discovery and a command-file/official CLI adapter; the app does not request
Apple Events automation permission. Local agents are optional and authenticate with a private token.
The shared connection uses its configured access set; named clients have independent scopes and
capabilities. Add the final signed-runtime evidence and any verified OS-specific limitation to these
notes before review.

## Screenshot brief

Capture the final signed submission candidate using only generated files, in the pixel sizes
accepted by the current App Store Connect form. Validate those sizes there before producing final
upload assets.

1. Folder browsing and a related preview in spatial planes.
2. The same workspace with a DXF drawing and visible measurement.
3. A supported STEP/STL/3MF model with readable neutral lighting.
4. Context search and grouped actions, with a legible long filename.
5. A reviewed local rename/organization proposal.
6. A configured terminal plane and commented configuration; disclose optional setup without showing
   secrets.

Screenshots must show shipped behavior, not mockups. Inspect text at upload scale. Exclude private
paths, tokens, paid-provider credentials and unrelated applications.

## App Privacy review worksheet

Ordinary browsing/indexing/previews keep data on the Mac. Model calls transmit user instructions and
approved filename/metadata/excerpt/text evidence directly to the configured provider, with ordinary
connection/account metadata. External commands, terminal apps and user-connected agents may have
independent data flows. Support reports are sent manually. Apple distribution/diagnostics are
separate services.

Resolve the final answers with the publisher and each enabled third-party flow. A lack of analytics
does not establish “Data Not Collected.” Review whether optional processing, retention, account
linkage and provider routing change the declaration.
[Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/),
[explicit consent for third-party AI in the Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing).
