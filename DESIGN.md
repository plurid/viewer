---
name: Viewer
description: The current Plurid application system for dense file browsing and linked spatial previews.
colors:
  space: '#272a30'
  surface: '#31353d'
  raised: '#393e47'
  ink: '#f2f4f6'
  muted: '#b1bac6'
  subtle: '#9fabb9'
  accent: '#82b3cf'
  line: '#454b55'
  selection: '#3a5368'
  selection-muted: '#c4d7e3'
  danger: '#ff9da0'
  field: '#292d34'
  light-space: '#eef0f4'
  light-surface: '#ffffff'
  light-raised: '#f4f6f8'
  light-ink: '#202733'
  light-muted: '#546071'
  light-subtle: '#637084'
  light-accent: '#337396'
  light-line: '#d5dbe2'
  light-selection: '#dcebf4'
  light-selection-muted: '#546071'
  light-danger: '#a62f3e'
  light-field: '#f4f6f8'
  file-image: '#b7ba93'
  file-code: '#b4aecf'
  light-file-image: '#686d32'
  light-file-code: '#6c5d9c'
  syntax-string: '#b7c79e'
  syntax-keyword: '#c9b4d6'
  syntax-number: '#dfb891'
  light-syntax-string: '#386731'
  light-syntax-keyword: '#755183'
  light-syntax-number: '#805d32'
  terminal-space: '#25282e'
  terminal-ink: '#eeeeef'
  terminal-cursor: '#9abfd1'
  light-terminal-space: '#f5f6f8'
  light-terminal-ink: '#25282e'
  light-terminal-cursor: '#40748d'
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.45
  body-compact:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '11px'
    fontWeight: 400
    lineHeight: 1.45
  section-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '12px'
    fontWeight: 600
    lineHeight: 1.3
  settings-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '22px'
    fontWeight: 600
    lineHeight: 1.45
  settings-section:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '14px'
    fontWeight: 600
    lineHeight: 1.45
  code:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: '22px'
  terminal:
    fontFamily: 'Menlo, Monaco, monospace'
    fontSize: '13px'
  command-output:
    fontFamily: 'Menlo, monospace'
    fontSize: '12px'
    lineHeight: 1.5
rounded:
  control: '5px'
  tile: '6px'
  stage-panel: '7px'
  menu: '8px'
  dialog: '10px'
spacing:
  tight: '4px'
  small: '6px'
  inline: '8px'
  content: '12px'
  panel: '16px'
  dialog: '18px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.space}'
    rounded: '{rounded.control}'
    padding: '6px 10px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '6px 10px'
  button-ghost-hover:
    backgroundColor: '{colors.raised}'
  button-selected:
    backgroundColor: '{colors.selection}'
    textColor: '{colors.ink}'
  icon-button:
    rounded: '{rounded.control}'
    padding: '5px'
    size: '30px'
  plane-icon-button:
    rounded: '{rounded.control}'
    padding: '5px'
    size: '28px'
  input-field:
    backgroundColor: '{colors.field}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '7px 9px'
  location:
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '6px 9px'
  location-selected:
    backgroundColor: '{colors.selection}'
    textColor: '{colors.ink}'
  app-titlebar:
    backgroundColor: '{colors.space}'
    padding: '0 18px 0 0'
    height: '56px'
  workspace-switcher:
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '6px 10px'
  count-badge:
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    padding: '0 3px'
  file-row:
    typography: '{typography.body-compact}'
    textColor: '{colors.ink}'
    padding: '0 18px'
    height: '36px'
  file-row-selected:
    backgroundColor: '{colors.selection}'
  file-row-compact:
    height: '30px'
  plane-header:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.ink}'
    typography: '{typography.title}'
    padding: '0 6px'
    height: '40px'
  context-menu:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.menu}'
    width: '304px'
  command-palette:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.dialog}'
    width: '560px'
  operations-popover:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.menu}'
    width: '370px'
  dialog:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.dialog}'
    width: '440px'
  settings-window:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
  settings-navigation:
    backgroundColor: '{colors.space}'
    padding: '18px 12px'
    width: '190px'
  settings-category:
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '9px 12px'
  settings-category-selected:
    backgroundColor: '{colors.selection}'
    textColor: '{colors.ink}'
  settings-page:
    padding: '28px 32px 40px'
  task-row:
    typography: '{typography.body}'
    textColor: '{colors.ink}'
    padding: '8px 18px'
  task-destination:
    typography: '{typography.body-compact}'
    backgroundColor: '{colors.field}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '7px 9px'
  model-shading-panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.stage-panel}'
    padding: '12px'
    width: '270px'
  linked-plane-marker:
    backgroundColor: 'transparent'
    textColor: '{colors.accent}'
    rounded: '{rounded.control}'
    padding: '4px'
    size: '24px'
  trash-inventory-dialog:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.dialog}'
    width: 'min(940px, 94vw)'
    height: 'min(680px, 88vh)'
  trash-inventory-row:
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    padding: '0 20px'
    height: '48px'
  trash-inventory-heading:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.muted}'
    typography: '{typography.body-compact}'
    padding: '0 20px'
    height: '42px'
---

# Design System: Viewer

## Overview

**Creative North Star: "Current Plurid application family"**

Viewer inherits the user-confirmed Plurid world: graphite surfaces, system typography, dense native file rows, and one coordinated look for the application shell and spatial engine. Familiar desktop controls remain legible while the workspace shows folders and their linked previews together.

The defining visual behavior is a titled file plane beside its folder, with a visible relationship and a focused docked view available through scoped commands. File contents supply the imagery and dimensional detail; the interface uses restrained surfaces and authored SVG icons. Quiet window chrome and one contextual header per plane keep the current task prominent.

**Key Characteristics:**

- Coordinated dark and light shell and engine looks, with appearance in Settings.
- Dense rows, quiet metadata, and explicit selection and active-command feedback.
- Linked spatial planes with compact contextual controls and focused docking.
- Searchable actions with an explicit target and truthful feedback.
- A separate searchable Settings window with stable dimensions, shared JSONC configuration and live preferences.
- Filename-first finding and proposal review with explicit scope, evidence, and Apply/Undo.
- Declarative custom commands and real terminal planes within the same quiet desktop grammar.
- File-content previews within the same visual system.
- Project recovery, plane-note and file-inspection controls reuse compact buttons, neutral surfaces and explicit choices; recovery notices keep workspace chrome reachable.
- Named client settings, checkpoints, comparison and collections extend the existing Settings, review and file-list patterns.
- Workflow definitions, runs and receipts use native disclosures and the existing review, field and selected-metadata treatments.
- Related-file records name their basis, while watch-rule approval keeps folder, file-type and local-content scope visible.
- Model presentation uses compact Shading controls within the existing content stage.
- Child headers and filename markers return to existing linked planes while retaining docked or spatial presentation.
- Applications and virtual Trash reuse ordinary sidebar rows; Trash inventory keeps access status and its footer visible.

Extracted from [renderer styles](packages/viewer-electron/app/src/renderer/styles.css), [engine looks](packages/viewer-electron/app/src/renderer/workspace/look.ts), [window chrome](packages/viewer-electron/app/src/renderer/App.tsx), [plane headers](packages/viewer-electron/app/src/renderer/workspace/PlaneHeader.tsx), [shared commands](packages/viewer-electron/app/src/renderer/commands/registry.ts), [sidebar](packages/viewer-electron/app/src/renderer/ui/Sidebar.tsx), [Settings](packages/viewer-electron/app/src/renderer/ui/Settings.tsx), and [file views](packages/viewer-electron/app/src/renderer/explorer/views.tsx). [PRODUCT.md](PRODUCT.md) is the confirmed authority for the incumbent family and desktop constraints.

The current extension also follows [linked-plane geometry](packages/viewer-electron/app/src/renderer/workspace/WorkspaceSurface.tsx), [native Settings lifecycle](packages/viewer-electron/app/src/main.ts), [filename finder](packages/viewer-electron/app/src/renderer/commands/CommandPalette.tsx), [virtual search roots](packages/viewer-electron/app/src/renderer/explorer/SearchExplorer.tsx), [action review](packages/viewer-electron/app/src/renderer/actions/ActionHub.tsx), and [EPUB preview](packages/viewer-electron/app/src/renderer/previews/modules/EPUBPreview.tsx). [Automation settings](packages/viewer-electron/app/src/renderer/ui/AutomationSettings.tsx), [agent review](packages/viewer-electron/app/src/renderer/actions/AgentReview.tsx) and [terminal planes](packages/viewer-electron/app/src/renderer/terminals/TerminalPlane.tsx) extend that incumbent through code; no approved visual comp supplies a replacement identity.

[Project controls](packages/viewer-electron/app/src/renderer/workspace/projects.tsx) and [inspection and notes](packages/viewer-electron/app/src/renderer/ui/Inspection.tsx) extend the existing dialog family. Their rendered evidence is [dark inspection](packages/viewer-electron/app/out/project-acceptance/inspection.png), [dark arrangements](packages/viewer-electron/app/out/project-acceptance/arrangements.png), [light notes](packages/viewer-electron/app/out/project-acceptance/notes-light.png) and [compact light arrangements](packages/viewer-electron/app/out/project-acceptance/arrangements-compact-light.png). These screens establish no new visual identity.

The later additions follow [named agent clients](packages/viewer-electron/app/src/renderer/ui/AgentClients.tsx), [checkpoints](packages/viewer-electron/app/src/renderer/ui/Checkpoints.tsx), [comparison](packages/viewer-electron/app/src/renderer/ui/Comparison.tsx), [operation review](packages/viewer-electron/app/src/renderer/ui/OperationReview.tsx), [collections](packages/viewer-electron/app/src/renderer/ui/Collections.tsx) and the [collection explorer](packages/viewer-electron/app/src/renderer/explorer/CollectionExplorer.tsx). Rendered evidence covers [dark client settings](packages/viewer-electron/app/out/agent-client-acceptance/clients.png), the [review checkpoint option](packages/viewer-electron/app/out/change-review-acceptance/review.png), [comparison](packages/viewer-electron/app/out/comparison-collection-acceptance/comparison.png), [operation review](packages/viewer-electron/app/out/comparison-collection-acceptance/operation-review.png) and the [collections manager](packages/viewer-electron/app/out/comparison-collection-acceptance/collections.png). Configuration disclosure, checkpoint-manager details and the unobscured collection-plane layout are source-derived. Current Agent client evidence is recorded below; the other additions have no verified light, compact or error renders, or screen-reader runtime evidence.

[Workflow controls](packages/viewer-electron/app/src/renderer/ui/Workflows.tsx), [workflow artifacts](packages/viewer-electron/app/src/renderer/ui/WorkflowArtifact.tsx) and the [project-file notice](packages/viewer-electron/app/src/renderer/workspace/projects.tsx) extend the same system. Their evidence includes [dark review waiting](packages/viewer-electron/app/out/workflow-acceptance/waiting-review.png), [light review waiting](packages/viewer-electron/app/out/workflow-acceptance/waiting-review-light.png), [light completion](packages/viewer-electron/app/out/workflow-acceptance/completed-light.png), the [dark editor](packages/viewer-electron/app/out/workflow-acceptance/editor-dark.png), the [light editor](packages/viewer-electron/app/out/workflow-acceptance/editor-light.png) and the [project change notice](packages/viewer-electron/app/out/project-acceptance/project-file-notice.png). Native pickers, long-content, workflow error/compact states and screen-reader runtime remain unverified for this extension. Current project recovery evidence is recorded below.

[Related files](packages/viewer-electron/app/src/renderer/ui/Relationships.tsx), its [map](packages/viewer-electron/app/src/renderer/ui/RelationshipMap.tsx) and [basis labels](packages/viewer-electron/app/src/renderer/ui/relationship-labels.ts), plus [watch rules](packages/viewer-electron/app/src/renderer/ui/WatchRules.tsx) within Workflows, retain this incumbent treatment. Their captured evidence is the [light relationship list](packages/viewer-electron/app/out/workflow-acceptance/relationships-list-light.png), [light map](packages/viewer-electron/app/out/workflow-acceptance/relationships-map-light.png), [dark watch approval](packages/viewer-electron/app/out/watch-rule-acceptance/approval-dark.png), [light watch approval](packages/viewer-electron/app/out/watch-rule-acceptance/approval-light.png) and [light watch review waiting](packages/viewer-electron/app/out/watch-rule-acceptance/waiting-review-light.png), all at 1440×940. Related files has no verified dark, compact, long-content or many-node render, or screen-reader runtime evidence. Watch scope was seeded through the real API for these captures; the native folder picker remains unverified.

The model, linked-navigation and Trash extension is code-led within this existing world, without a replacement visual system. Sources are [Shading controls](packages/viewer-electron/app/src/renderer/previews/model/ShadingControls.tsx), [model appearance](packages/viewer-electron/app/src/renderer/previews/model/appearance.ts), [ModelPreview](packages/viewer-electron/app/src/renderer/previews/modules/ModelPreview.tsx), [linked markers](packages/viewer-electron/app/src/renderer/workspace/LinkedPlaneButton.tsx), [plane navigation](packages/viewer-electron/app/src/renderer/workspace/controller.ts), [Trash inventory](packages/viewer-electron/app/src/renderer/ui/Trash.tsx), the [desktop Trash service](packages/viewer-electron/app/src/desktop/trash.ts) and [native macOS menu/confirmation](packages/viewer-electron/app/tools/trash-ui.h). Current evidence comprises 14 [model/navigation captures](.impeccable/review/models-links-trash-v3/model-navigation-acceptance-MigAQR), four [fixture-based populated Trash renders](.impeccable/review/models-links-trash-v3/trash-ui-acceptance) and three [native read-only captures](.impeccable/review/models-links-trash-v3/trash-readonly-acceptance-qEwPUo). All 21 supplied captures were validated; the finish review returned ship with no material fixes. The earlier `trash-readonly-acceptance-dWr3Hd` evidence is superseded and preserved.

## Colors

The palette uses graphite neutrals in dark mode and pale neutral space with white content surfaces in light mode. Frontmatter names without a `light-` prefix describe the default dark look; prefixed names are the corresponding light values. Switching the look replaces the source CSS variables and sends the same space, surface, ink, and accent values to the engine.

### Primary

- **Muted blue accent:** `accent` and `light-accent` mark folder/model icons, active navigation icons, the input caret, links, progress, and the primary action. They do not replace the neutral content surface.
- **Blue selection:** `selection` and `light-selection` identify selected controls and files. Selected file metadata uses the corresponding `selection-muted` value.

### Neutral

- **Workspace:** `space` sits behind planes; `surface` carries folder and preview contents, dialogs, searchable actions, and the operations popover.
- **Raised and field surfaces:** `raised` separates contextual plane headers and hover states; `field` separates inputs, file headers, and content stages.
- **Text:** `ink` is the primary reading color; `muted` carries metadata and supporting labels; `subtle` carries placeholders and quieter status information.
- **Dividers:** `line` defines shell boundaries and controls. Dense file/archive rows mix this source color with transparency for a quieter divider.

File-family colors distinguish image files and code/data files. Syntax colors distinguish strings, keywords, and numeric values inside code/JSON previews; light mode has its own darker syntax values. `danger` identifies errors and destructive actions. These are content and state colors, not additional identity accents.

Terminal contents use the recorded `terminal-space`, `terminal-ink` and `terminal-cursor` roles, with their light counterparts. Their surrounding header and search controls retain the shell's existing surface, text and accent roles.

**The Shared Look Rule.** Apply the selected look to both the shell and the spatial engine; extend previews with the same surface and text roles.

**The Selected Metadata Rule.** Use the selected metadata role on selected rows, tiles, and gallery items so secondary information stays readable against selection.

Selected workflow-run status and timestamps extend the same selected-metadata treatment: `.workflow-run-choice[aria-pressed='true'] span` uses `selection-muted` over selection. The reviewed dark pair measures 5.42:1; ordinary unselected run metadata keeps the muted role.

## Typography

**Body Font:** The platform system stack recorded in frontmatter.

**Label/Mono Font:** The system stack for interface labels; the recorded monospace stack for code, JSON, and tabular data content.

The interface has a compact functional hierarchy. Weight distinguishes plane titles and sidebar sections, while smaller text carries file metadata. There is no shared display or marketing headline tier.

### Hierarchy

- **Title:** The `title` role names planes; sidebar section names use `section-label`.
- **Settings hierarchy:** The `settings-title` role names the selected category or Search results; `settings-section` separates groups and editors in that window. Both use the existing system family and semibold weight.
- **Body:** The `body` role serves controls and application text; `body-compact` serves file names and supporting preview text.
- **Label:** The `label` role serves file metadata, column headers, status bars, and preview metadata.
- **Code:** The `code` role serves source listings. JSON retains its observed taller line spacing (24px); CSV uses its content-specific monospace row treatment (11px/32px).
- **Terminal:** The `terminal` role serves shell output in the xterm screen; `command-output` serves process output and agent proposal details inside their bounded surfaces.

Use tabular numerals for file sizes and operation counts. File and plane names truncate to one line; error text and document content can wrap. Markdown and EPUB headings belong to the displayed document and retain their content hierarchy. EPUB reading text starts at 17px with a user-adjustable size; it does not establish a new application display face.

**The Content Hierarchy Rule.** Keep document headings and syntax styling inside previews; extend application chrome with its compact title, body, and label roles, and use the established Settings heading roles within that separate window.

## Layout

The shell fills the native window. The draggable titlebar (56px) reserves the left inset for macOS window controls (94px). It contains window navigation visibility, the searchable workspace selector, a compact plus for a new root folder plane, conditional operations/action tasks, and Commands. The window has no in-window wordmark, tagline, plane tabs, global arrangement toolbar, theme button, or global shortcut/count footer. Buttons remain outside the native drag region.

The visible sidebar starts at its saved/default width (210px), resizes within its bounds (160–360px), and can hide completely. Folder planes show the shared navigation component by default, with a direct header toggle and independent width/visibility; its actions navigate that plane. Shortcut order, aliases, Favorites and section folding are shared. Window navigation starts hidden and remains optional. Settings controls navigation in later new planes. The projected resizer handles spatial zoom and perspective, and caps rendered navigation at half a narrow plane’s content width. Sidebars and plane bodies scroll independently of their chrome. The native window minimum is implemented (780×560). Adapt to available workspace and plane dimensions rather than switching to a phone navigation pattern.

Every plane has one contextual header (40px), with compact icon actions (28px). A plane-width container query (540px) hides forward navigation, frame/dock icons and secondary preview labels, and narrows the preview control slot from 64% to 50%; that slot can scroll horizontally. Titles retain ellipsis. Path entry, breadcrumbs/filtering, folder search, and secondary actions appear on demand. Search toggles from the header and clears/cancels its query on close. Scoped commands keep actions available when compact chrome hides them.

Automatic planes follow the measured workspace: width is bounded from 380px to 960px with 32px of horizontal clearance; height is bounded from 300px to 660px with 72px of vertical clearance. Manual resizing is configurable. Framing waits for the live viewport and measured planes to settle. Each linked child is placed at 90.1° from its parent and faces the camera when opened; Settings offers linked-pair framing or docking. An existing path/type focuses its plane within the originating root while retaining its link and position; the same file opened from another root keeps a separate preview. Terminal sessions likewise belong to their originating root. Open in another plane creates an independent root without a parent link. Refitting preserves deliberate camera movement. Reopening keeps a usable saved view and brings a clipped active plane into view. Explicit consolidation of repeated previews keeps the active placement, protects deliberate copies and branches, and offers one-step arrangement undo.

File lists use virtualized rows (36px comfortable, 30px compact), with a flexible name column and configurable metadata columns. Folder and search headers share their grid, insets and horizontal viewport with the rows. Name aligns with filename text after its icon; dates and kind align left, size right. Browsing Settings and header actions show or hide Modified, Created, Kind, Extension and Size; Name stays visible. Narrow planes scroll horizontally instead of hiding configured fields. Column dividers resize through projected pointer coordinates or keyboard steps; double-click restores the default width. Pointer movement updates grid variables without publishing preferences until release. Filenames retain their full-name tooltip; optional wrapping measures natural row heights. Grid and gallery use contained thumbnails and truncated file names; columns retain separate scrollable folder lists. Small control gaps and the repeated frontmatter spacing steps keep chrome compact. Dialog content uses the larger panel/dialog steps.

Folder view, sort, metadata layout and browsing-column width are shared by path across roots and workspaces. Selection, history, filters and scroll remain local to each explorer. Browsing-column edges resize in projected coordinates, adjusting the element directly during drag and saving on release. The separator supports Left/Right steps (10px, or 50px with Shift), Home/End limits (160–1600px), double-click fitting to filenames and Option to apply the width to the visible trail.

Model Shading uses a stage-contained panel with a small inset (12px from the top/right), the recorded width and internal padding, and bounds of `calc(100% - 24px)` in both axes. Its own scroll area and stable scrollbar gutter keep controls reachable in compact Quick Preview and linked planes. Trash uses the recorded larger dialog bounds, the inherited viewport maximum width of `calc(100vw - 60px)`, a flexible scrolling body and a nonshrinking header/footer. Its inventory keeps the heading separate from virtual rows; inventory columns scroll horizontally when their minimum widths exceed the available space.

Transient surfaces remain bounded by the native viewport. Searchable context actions use a compact width (304px); the command palette is wider (560px). The palette anchors its top edge at 22% of the window height, bounded to 80–240px, and keeps its search field stationary as results grow downward. Its result list scrolls before reaching the bottom clearance (20px). The operations popover anchors below the upper-right control (370px wide, 64px from the top, 16px from the right) and scrolls within the window. It never consumes workspace width.

An empty workspace offers New folder plane directly and Open folder… as a secondary action. Configure two independent starting locations in Settings → Browsing. The first plane of an empty workspace defaults to Home and supports standard locations or a custom folder. Further new roots default to Current folder and use the ordinary starting-folder preference. The workspace + button and Command-N use the same distinction. A custom folder uses the native picker and Settings shows its full path beside Change folder…. Cancelling keeps the previous choice. The empty workspace contains creation actions without preference controls.

Settings occupies a separate modeless native window: default outer size 900×640px and minimum outer size 760×540px. Category changes keep the window size stable; user resizing and the last category persist. The content uses a navigation column (190px) and a flexible page. Navigation and page scroll independently, with the page's recorded inset (28px 32px 40px) and a stable gutter so expanded recipe editors never move fields horizontally.

Quick Preview combines quiet module/size metadata, previous/next navigation and its two open actions in one footer. The default-open button names the OS application, such as Open in Code, and falls back to Open when no name is available. Long application names truncate visually while retaining their complete tooltip. File identity stays in the dialog title; no second metadata footer or external-open icon repeats those actions.

PDF uses the measured scroll-stage content box, excluding its existing inset (24px). Fit page takes the smaller width or height ratio and adapts when the stage, search rows or page dimensions change. The white sheet remains a block with content-sized width and automatic horizontal margins: smaller pages center, while oversized pages retain a reachable left edge.

Get Info uses the existing 440px dialog, with a maximum width of `calc(100vw - 60px)`. Its content scrolls within `min(550px, calc(100vh - 200px))` and retains the 18px dialog inset. The filename and wrapping path span the full width above a 90px label column and flexible value column, separated by 12px. Native allocation, owner and group values form a wrapping strip. Save/Reload stays sticky within the content area; Done remains in the separate dialog footer.

Project, inspection and notes use that same dialog width and maximum width. Their shared content region (`.dialog-body`) keeps the dialog inset (18px), scrolls within `min(580px, calc(100vh - 180px))`, and leaves the existing separated footer intact. Project and inspection groups use the content spacing step (12px). In arrangement rows, the name is a flexible, shrinkable column with `overflow-wrap: anywhere`; Restore does not shrink. The rendered long name wraps with Restore and Done visible at 1440×940 in dark mode and 900×640 in light mode. No additional responsive breakpoint is introduced.

Proposal review is a bounded modal surface, with width `min(920px, calc(100vw - 80px))` and height `min(700px, calc(100vh - 90px))`. Context, selection, evidence, and footer surround a scrollable virtual row area. Each row gives the editable filename the available width; the directory is quieter context below it. Virtual search roots use the folder list layout and a local result status/paging strip within their own plane.

Comparison, operation review and Collections and basket reuse the wide-dialog variant (1050px), bounded by the existing dialog maximum width and `calc(100vh - 60px)` maximum height. Their shared body retains its 18px inset and scroll boundary, with panel spacing (16px) between groups. Comparison has two flexible location columns and a horizontally scrollable results grid whose rows have a minimum width (650px). Operation review removes the form's extra inset so the body owns its spacing and the separated footer retains its 16px inset. Comparison and operation review render up to 100 rows per page with Previous, Next and the visible range. These are source-defined layout behaviors; the supplied dark screens do not establish additional responsive guarantees.

Workflows narrows the wide-dialog variant through `.workflow-dialog` to `min(900px, calc(100vw - 48px))`; the inherited dialog maximum width remains in effect. The shared dialog body scrolls with its existing inset. `.workflow-body` separates main groups (24px), while sections and definition contents use 14px gaps. Ordered steps use 16px gaps and a 24px list inset. The project-file status notice occupies normal flow between the titlebar and app body, with margins (12px 24px), a wrapping flexible message and ordinary nonshrinking actions. It reserves its own height so it cannot cover the docked plane toolbar. Current desktop dark and compact light captures verify the recovery treatment; longer text and wrapping remain source-defined.

Related files uses the shared wide dialog and scrolling body. `.relationships-body` has the existing dialog spacing step (18px); divided list records use 16px vertical padding and 12px internal gaps, with two endpoint columns separated by 24px. The map occupies a bounded scroll region (420px maximum height) around a 900px SVG. The source caps it at the current file plus 20 related endpoints and 100 non-self links; its accompanying link list uses the same displayed endpoint set. The full relationship list pages in groups of 50. These source bounds do not establish a many-node or compact-layout guarantee. Watch approval remains inside the existing workflow body; `.watch-rule-form` uses 16px gaps within the incumbent padded form, with explanation text bounded to 70ch.

**The Reachable Chrome Rule.** Keep contextual plane headers and linked relationships within the framed viewport; expose frame and dock through scoped commands, and use docking for focused reading. Preserve usable saved camera views on reopen, recover a clipped active plane, and keep preview consolidation explicit and undoable.

## Elevation & Depth

Depth comes from the spatial engine, layered neutral surfaces, dividers, and restrained ambient shadows. Rows and ordinary controls stay flat. Searchable actions, dialogs, notices, and the anchored operations popover share the source overlay shadow; PDF sheets have a separate small page shadow.

### Shadow Vocabulary

- **Dark overlay:** `box-shadow: 0 18px 56px #0005` for transient surfaces in the default look.
- **Light overlay:** `box-shadow: 0 18px 56px #20304025` for the corresponding light surfaces.
- **PDF sheet:** `box-shadow: 0 2px 12px #0003` for the rendered white page within its content stage.

Engine camera transitions support framing and docking. Media and model activity is bounded by visibility; a model can orbit independently of its plane. Plane backs always show mirrored content; there is no backs setting. Minimap activation faces the selected plane and selects its command context. Plurid's native bottom toolbar, minimap and viewcube are on by default and each has a Settings switch. Transform origin defaults off. Headers, title dragging and resize handles have independent Settings switches. The toolbar, scoped commands and Escape share the engine's transform mode. CSS honors reduced motion, including the loading indicator.

**The Task Depth Rule.** Use elevation for spatial relationships and transient controls; preserve flat file rows for scanning.

## Shapes

Controls have modest rounding, grid tiles slightly larger rounding, and searchable actions/dialogs progressively softer corners, using the recorded radius roles. File rows, column separators, and preview content stages remain straight edged. Thin borders separate shell regions, inputs, and overlays.

Icons are authored SVGs on a 24×24 viewBox with a consistent outline stroke (1.6), rounded caps and joins, and inherited color. The shared More glyph uses three evenly spaced filled circles. Normal interface icons are usually 18px; file aliases use the same SVG system as a small overlay (11px). Retain the existing native application icon; preview imagery comes from the user's files.

## Components

### Buttons

Compact text and icon controls share the control radius. Ghost controls gain the raised surface on hover and selection on press; selected controls keep selection with primary text. Primary controls use accent with workspace-colored text and a stronger weight (600); hover brightens their accent. Disabled controls lower opacity (0.45). Icon buttons have a square footprint (30px in the shell and dialogs, 28px in plane headers), an SVG, and an accessible action label.

### Counts

The operations count is plain compact text with tabular numerals inside its conditional control. It has no filled badge background. It is informational; no general-purpose filter-chip system is established.

### Cards / Containers

Planes are the recurring content containers: neutral content surface, a raised contextual header, and bounded scrollable body. Dialogs use the dialog radius, line border, shared overlay shadow, and separated header/footer. Searchable context actions use the smaller menu radius with a search field above compact full-width rows. These patterns define containers without adding decorative cards around file content.

### Inputs / Fields

Fields use the field surface, line border, control radius, and subtle placeholder text. Inputs retain an accent caret; focus outlines and halos are suppressed at the user's request, including engine chrome. On-demand folder filtering and command search use transparent fields within separated search rows. Name dialogs focus their input after the native modal enters the top layer, and show readable inline errors.

### Navigation

The sidebar uses icon-and-label rows with ellipsis for long names. Selection changes the row surface and colors its icon with accent. Section buttons carry fold indicators and can reorder. Locations and Favorites can reorder their shortcuts; Recent remains chronological. Context actions provide alias names, visibility, and Favorite shortcuts. Folder drops into Favorites alter navigation preferences only. The resizer supports pointer and keyboard adjustment, and the topbar visibility action remains reachable while the sidebar is hidden.

The workspace selector opens the same searchable action pattern and truncates long names within a bounded control. New, Rename, and Delete workspace actions use compact dialogs. Delete names the workspace and plane count, explains layout-only removal, preserves files and running jobs, and exposes session recovery; deleting the last workspace creates a replacement. Breadcrumbs appear on demand, scroll horizontally, and give the current folder stronger text.

### File Rows

The dense row separates file identity from muted date, kind, and size metadata; file sizes align right. Hover uses the raised surface; selection changes the row and its metadata together. Alias overlays remain visible at native file-icon size. Grid and gallery carry the same file-selection treatment. In columns, Up/Down selection reveals a folder's next column; Right selects its first child and Left returns to its owning folder. The active column owns the operation destination, including paste into a displayed folder. Its keyboard scope, trail and operation directory survive Plurid detachment together and remap after directory moves. Drops target the hovered folder or column, with a destination highlight and Option for copy. A refreshed listing prunes missing folder branches, cached descendants and their selection together.

List folders use compact disclosure controls; Left/Right collapses or expands the local folder branch. Explorer commands claim their keys before camera movement: Command-Down opens, Command-Up goes to the parent and Command-1–4 selects list, grid, columns or gallery. Text fields, active menus/dialogs, preview gestures and terminal input keep their own keys. Focused resize separators indicate ownership with a selection-colored fill, preserving the confirmed absence of focus rings.

### Get Info

The local File information dialog keeps file identity and metadata compact within the established dialog family. A 14px semibold filename precedes its complete wrapped path; Kind, Size, Modified, Created and an available link Target use muted 11px labels and 12px values. Multiple selected entries retain separate sections with line dividers. Folder size calculation remains an explicit footer action.

On macOS, regular files and folders extend that information with allocation, owner and group, then Locked, Tags and Comments. Tags pair a 9px color dot with the textual tag name, a 112px selector that names the native color, and an accessible remove action. Add a tag uses an ordinary field/button row. Comments use the shared field surface, border and control radius in a vertically resizable textarea. Permissions stays behind a disclosure: Owner, Group and Everyone rows expose Read, Write and Execute, or Traverse for folders. Multi-item selection defers each editor behind Tags, comments and permissions.

Edits remain drafts until Save changes; Reload and Saved/Unsaved changes feedback share the sticky action row. Done closes the dialog from its own footer. Loading, saving, read-only volume, ownership, unsupported metadata and unreadable metadata states use the established status/error text and disabled controls. Locked disables tag, comment and permission edits. Preserve the existing keyboard focus surface/text feedback and suppression of rings and halos.

### Project Dialogs

Saved arrangements and Project folders use ordinary system-font rows within the shared dialog. Each row (`.project-control-row`) has a line divider, the panel gap (16px) and vertical padding (8px). The name or folder detail takes the remaining width; Restore and Choose… keep their footprint. Arrangement names, binding labels and folder paths wrap unbroken text rather than pushing actions outside the dialog. Save current arrangement… stays in the body, while Done occupies the existing footer. Saving a name uses the incumbent Name dialog; Reload project uses the incumbent confirmation pattern with Cancel and the primary action.

Project folders places its local-location explanation above the rows: choosing a folder authorizes that location. This permission copy uses the muted text role and stays with the affected controls. Project inline errors use the shared `.error` selector and `role="alert"`, inheriting the danger role and wrapping; their error-state appearance is source-verified, without a captured error screenshot.

Project controls save portable references to files and open planes, layouts, folder views and named arrangements; they do not copy the files. Close project uses an ordinary command row and recovery-strip button. It detaches only the definition, stops its watcher and resumes shared folder preferences while keeping open planes, layout and preview notes; it never writes, recreates or removes the project file.

An externally changed project produces the existing neutral status strip: surface fill, line border, tile rounding (6px), inset (12px 16px) and action gap (12px). Project file changed on disk. precedes Review updated project…, Close project and Dismiss. Review opens the incumbent Reload project confirmation. A missing definition instead says Project file is missing. Your open planes are still available. and offers only Close project and Dismiss; other errors can offer Retry…. Dismiss suppresses the same unchanged problem until recovery, a new problem or a change to the current association. The notice retains `role="status"`; screen-reader runtime remains unverified.

The [current native result](packages/viewer-electron/app/out/project-exit-acceptance-W3gqwv/result.json) records four passing groups: dismissal survives an unrelated folder notification; Close project persists detachment while retaining the open folder/root/active plane; cold restart retains the ordinary workspace; actual macOS Trash denial explains Full Disk Access with actions disabled. The supplied native run also passes the docked-toolbar geometry assertion. Seven [current captures](.impeccable/review/project-recovery-v2/project-exit-acceptance-W3gqwv) cover desktop dark (1440×940) and compact light (900×640) recovery, the visible Close project command, the retained workspace and Trash privacy denial. The parent reports 68 passing targeted tests, check/lint/format/build and local ad-hoc signature validation for `Viewer-project-recovery-v2-darwin-arm64/Viewer.app`; the fresh five-section finish review returned ship with no material fixes in source, current renders or independent old-build reproductions.

The three original user screenshot files became unavailable after initial viewing; four accessible old-build captures were reviewed as independent reproductions, not originals, so direct comparison to historical user pixels remains unavailable. No real deletion, Full Disk Access grant, physical Privacy Settings navigation or native erasure menu/confirmation was invoked. Signed App Sandbox access, post-grant behavior, other-platform execution, assistive technology and Store qualification remain unverified.

### Plane Notes

Plane notes uses a full-width, vertically resizable text field (`.plane-notes`) within the dialog body. It inherits the body font rather than the browser's textarea face, with the existing ink, field, line, control-radius and accent-caret roles. The field has a minimum height (220px) and an internal inset (10px). Cancel and the primary Save notes action remain in the separated footer. The light-mode evidence shows the shared field treatment and visible caret without a focus ring or halo.

### File Inspection

Inspect file starts with a complete wrapping muted path and a visible Read file contents checkbox. The initial choice is unchecked. For PDF files, Recognize scanned text on this Mac appears only after content reading is selected. Facts use a two-column grid (`.inspection-facts`): muted labels in `minmax(100px, 1fr)`, values in `minmax(0, 2fr)`, the panel gap (16px) and thin row dividers. Values wrap inside their available column.

Evidence passages use left-aligned ordinary buttons (`.inspection-passage`), with a stronger source label above quieter excerpt text. Both lines wrap unbroken text; the button is bounded to the available width. Loading and coverage copy remain plain task feedback, and Done stays in the footer. Inspection errors use the same `.error` and alert treatment as project errors; no captured error state establishes further styling.

**The Explicit Inspection Rule.** Keep the content-reading choice visible beside the facts; begin unchecked and reveal PDF scan recognition only within the chosen content-reading state.

### Contextual Plane Header

Folder headers combine a direct navigation toggle, back/forward navigation, a titled drag region, view menu, search, frame/dock, more actions, and close. Space Settings controls each of these icons independently. The view and actions buttons toggle their own menus; pointer dismissal ignores the originating button so a second click closes the open menu. Preview headers replace folder navigation/view/search with the module's primary controls in the same header. There is no second permanent preview toolbar in a linked plane. The first title press selects and moves the plane; pressing an already selected plane retains the current multiselection. File selection, text selection, media, image, and model gestures keep their own functions. Duplicate floating engine controls remain disabled.

Images, models, PDF, text, and media contribute commands scoped to their preview. Keep zoom, fit, page, search, and playback actions with the preview they affect; unavailable actions do not appear as command results. Supplemental file information stays compact within the plane body.

### Linked Plane Navigation

Back to parent plane uses the existing outline SVG and plane icon-button footprint at the start of a child header. Space → Plane toolbar controls its visibility. It appears only when an immediate parent exists; Option-Command-Up invokes the same scoped action. Root planes omit it. This navigates the plane relationship without changing folder history.

A compact accent link glyph sits beside an originating filename in list, grid and browsing columns; gallery places it at the tile's upper-right corner on the existing surface. The marker uses the recorded square footprint and a small SVG (14px), an accessible label naming its file, and the View linked plane tooltip. It appears only for that parent's live direct child. Pointer and keyboard activation focus the existing child without opening another plane or activating the surrounding file row. View open plane provides the corresponding context command for one matching file or folder, preferring its direct child and then a matching plane in the same root.

**The Existing Plane Rule.** Return to the immediate parent or an existing matching plane while retaining the current docked or spatial presentation; keep agent navigation in the reviewed, destination-scoped focus tool.

The [native model/navigation result](packages/viewer-electron/app/out/model-navigation-acceptance-MigAQR/result.json) verifies parent navigation, its visibility preference and root omission, marker activation by keyboard, markers in all four file views, and reuse without increasing pane count. The [parent list](.impeccable/review/models-links-trash-v3/model-navigation-acceptance-MigAQR/parent-link-markers-dark.png) and [gallery](.impeccable/review/models-links-trash-v3/model-navigation-acceptance-MigAQR/gallery-link-marker-dark.png) captures show the incumbent selection and glyph treatment.

### Applications and Trash

Applications is an ordinary directory shortcut with the existing grid glyph. On macOS it opens `/Applications` in the current folder plane using normal directory navigation. Trash uses the existing Trash glyph and a virtual sidebar target; Windows labels the destination Recycle Bin. Activating it opens a dedicated read-only dialog rather than exposing the system Trash folder as an editable explorer.

The inventory uses the recorded heading and row roles with Name, Trash location and right-aligned Size. Original location appears only when at least one item has known source metadata; missing values in that column and folder sizes use an em dash. Filename and path cells truncate with full-value tooltips. Rows use file/folder SVGs, thin dividers and virtual scrolling, without selection, item preview, restore or per-item erase controls. The table exposes source-derived row/header/cell semantics; assistive-technology runtime remains unverified.

The separated footer keeps the visible count on the left and Refresh, Trash actions and Done on the right, wrapping when necessary. Trash actions opens a native menu only when the complete nonempty inventory is available and the native bridge is present. Unavailable locations show their name, wrapping permission/error detail and the supported recovery action. Zero readable items with an unavailable location says Trash is unavailable and counts items visible; a readable empty inventory says Trash is empty. Partial or truncated inventory keeps the actions disabled and explains the limit. On macOS, `EPERM`/`EACCES` explains user-granted Full Disk Access, enabling Viewer in Privacy & Security and quitting/reopening it. Open Privacy Settings… uses only the fixed system-settings URL; it neither grants access nor widens agent scope. A folder picker cannot grant Full Disk Access. The separate `FILE_ACCESS_REQUIRED` state retains Allow folder access… and a native chooser for the exact hidden private Trash directory, with Command-Shift-G guidance. Signed App Sandbox access and successful post-grant behavior remain unqualified.

**The Trash State Rule.** Keep unavailable, incomplete and empty inventories distinct, retain readable location feedback and the footer, and leave Trash actions disabled until the full inventory can be read.

Empty Trash… belongs solely to a native menu selection followed by an unconditional native warning with Cancel as the default. The confirmation names permanent erasure, the item count and trashed-folder contents. Viewer exposes no erasure/approve endpoint, command, shortcut, MCP or scheduled route; editable JSONC and saved grants do not change this flow. Coding agents must never select or approve Empty Trash. This records Viewer's own boundary, without claiming control over other programs.

The [native read-only result](packages/viewer-electron/app/out/trash-readonly-acceptance-qEwPUo/result.json) confirms Applications navigation and the actual macOS permission-denied inventory with actions disabled. Its [compact denied state](.impeccable/review/models-links-trash-v3/trash-readonly-acceptance-qEwPUo/native-trash-compact-dark.png) records the earlier Allow access… label, superseded by the current [dark privacy-denied view](.impeccable/review/project-recovery-v2/project-exit-acceptance-W3gqwv/trash-permission-dark.png) and [compact light view](.impeccable/review/project-recovery-v2/project-exit-acceptance-W3gqwv/trash-permission-compact-light.png) with Open Privacy Settings…, status, Refresh and Done; the [compact populated light render](.impeccable/review/models-links-trash-v3/trash-ui-acceptance/populated-compact-light.png) is fixture evidence for row and footer presentation. The native run invoked no grant picker, Trash menu, confirmation or erasure. Supplied verification also reports 60 passing in-memory tests and 13 native C++ guards with `unlinkat` replaced by a no-op. Positive native emptying, post-grant macOS browsing, Windows/Linux execution, assistive technology and Store qualification remain unverified. No user data was removed.

### Searchable Actions

Command-K and autofocus right-click actions share the typed command registry, row appearance, and keyboard navigation. Action rows pair an SVG and label with optional detail and shortcut. Search retains focus while the active result uses the selection surface and selected metadata role. Arrow keys, Home/End, Enter, and Escape navigate, invoke, and dismiss. Aliases such as `rn`, `cp`, and `nf` rank the corresponding action. Command-K and search rank each applicable command once, promoting up to two recent commands.

Right-click presents Recent shortcuts and pinned actions first. A Recent shortcut also remains in its normal group, with a separate row ID; search returns one result per command. Copy path is a direct action for selected files/folders or the current folder, copying newline-separated absolute paths as text with Option-Command-C. The menu separates opening, editing and information actions. Other categories use named flyouts; View contains the view modes, Group by, Columns and folder-view defaults. A scoped header menu presents its own choices immediately. Search flattens every submenu without changing command availability or captured targets. Right enters a flyout; Left or Escape returns one level. Pointer entry opens after a short delay, without updates for every pixel of movement. Flyouts continue toward free space and stay inside the viewport; search remains fixed while results scroll.

Targets remain explicit: a context menu binds its clicked item or captured selection; Commands reflects the active context. Pointer hover updates the active result without forcing scroll; keyboard movement scrolls that result into view, and a changed query returns to the top. Menu scroll is contained. Copy/Move to continues through a destination step. Empty searches state that no actions/files match, and folder reading or errors receive their own readable feedback.

### File Finding and Virtual Search Roots

Command-F opens the same compact searchable result pattern with filename as the primary label and a quieter parent-directory detail when needed. Its scope select names This folder, Subfolders, and Indexed locations. Folder scope ranks the current listing; subfolder scope searches the subtree; Indexed locations and Document text use the local background index. Scope and document-text permission stay visible alongside Open results and Save search. Text indexing requires a separately enabled location in Settings → Search; unavailable or incomplete indexing receives inline feedback.

Open results creates an independent virtual root; saved searches use the same root pattern when reopened. Its header and query/scope row belong to that plane. Results retain ordinary file selection, file commands, context actions, drag, and Quick Preview; opening a result links its preview to this search root. The result strip shows indexing status or the current page with Previous/Next. Search selection and cached file identity use the same browsing sessions as folders.

**The Search Scope Rule.** Keep filename identity primary and search scope explicit; distinguish local names/metadata from separately granted document-text indexing, and present search results as file-capable virtual roots.

### Settings

Command-comma opens or focuses the separate modeless Settings window. Its searchable categories are Browsing, Navigation, Previews, Space, Search, Permissions, Actions, Models, Agents, Shortcuts, Terminals, Configuration and Privacy. A selected category uses the selection surface; typed queries search labels, details, and category names, with discovery links for service editors. Native titlebar controls close the window. Category/page changes preserve its size. Preference changes update the main window live; text fields commit on blur, the reusable single-line text editor also accepts Enter, and native close blurs the active field and flushes queued writes. Successive custom-action, profile and tmux edits retain earlier accepted changes while saves queue.

Browsing carries System, Dark, and Light appearance, default view, density, hidden-file and restore preferences, and a List columns section for optional fields and filename wrapping. Navigation uses the shared section/shortcut language. Space keeps face-on opening, headers, title dragging, resize handles and all three native spatial aids on by default; its Plane toolbar section controls individual icons. Transform origin stays off. Plane backs are always visible with no option. Search lists indexed locations with status/counts, per-location Contents grants, add/remove, pause/rebuild, saved queries and exclusions. Long paths wrap within the flexible content column.

Settings uses 16px before action groups, 12px between related controls and 28px before section headings. At narrow page widths, long fields stack beneath labels. Authorized folders precede execution grants, and selected paths remain readable. Toolbar preferences show the actual glyph beside their checkbox, using the selection surface when enabled.

Actions uses expandable recipe rows and a reusable label/field editor for name, type, formats, recursion, template, instructions, provider, permitted data, and shortcut. Filename templates stay visible for naming actions. New, duplicate, import, export, and applicable removal controls use ordinary compact buttons. The manual file-rename dialog adds a compact Rename actions selector beside its existing footer buttons. It shows applicable instruction, book and batch-rename recipes using the dialog's captured file target. Choosing one enters the ordinary action setup and proposal review flow. Recipe configuration does not bypass proposal review.

Custom commands use the same expandable rows in Actions. Name, aliases, shortcut, pinning, order and icon precede target/extension/selection availability and the executor-specific fields. Literal argument arrays use multiline JSON fields with inline validation; shell scripts appear only for an explicit Shell executor. Keep the chosen executor and its inputs legible within the existing field column.

Models starts with one provider picker and Add provider action for OpenAI, Anthropic, z.ai, DeepSeek, Qwen, Gemini, OpenRouter and local endpoints. Each profile names the provider, endpoint and model, with a separate document-text permission. Official cloud endpoints are read-only; Qwen and local endpoints accept supported custom bases. Connect and load models offers IDs where discovery is available; z.ai uses published suggestions without claiming a connection. Password fields show whether a key is stored and offer Clear stored key. No provider is enabled by default. Provider keys use protected desktop storage only through explicit credential operations.

Agents is opt-in, lists authorized folders with revocation controls, and generates selectable local MCP configuration only when enabled with a folder grant. The local agent token stays in private app metadata and does not use Keychain. Agent permissions keeps a Grant for folder selector and a selectable, wrapping complete folder path above the separate Read terminal output checkbox. Existing grants is a native disclosure; legacy execution/input entries show “Inactive; approval is required each time” and retain Revoke. Every agent command requires fresh in-app approval. No unattended custom-command or terminal-write grant switches are offered. The muted note names system Trash and the unavailable shell, executable, external-app and terminal-input routes. Configuration proposals require review, and recipe file changes keep row review and Apply. Keep permissions near the service they affect.

Terminals follows the same labeled fields and expandable profile rows: scrollback, external application, default shell profile, shell executable, literal arguments and environment, then the shared tmux-session fields. Arguments and environment use multiline JSON fields. Its note identifies the captured folder and explains that each embedded terminal owns a shell. Configuration shows a selectable, wrapping path, a primary Open config.jsonc action, Validate, readable diagnostics and recent changes, import/export, and section reset. The copy explains that Settings edits the same JSONC and invalid external edits leave the last valid configuration active. Credentials, layouts and execution approvals remain separate from that reset.

Shortcuts uses labeled editable bindings and a reset action; recipe bindings remain in Actions. Space remains Quick Preview. Model settings, agent configuration, and shortcut syntax belong in these configuration flows.

**The Settings Window Rule.** Keep Settings modeless, searchable and stable across categories, with live updates and close-flush; extend its editors with the shared system fonts, neutral surfaces and ordinary controls.

### Agent Clients

Agents extends its existing Settings page with divided rows of named clients (`.agent-client-row`). Each name is strong text above a muted capability summary or Revoked state. Permissions, Stop tasks, Revoke and Activity use the ordinary Settings action group; revoked rows retain Activity. The source uses wrapping flex rows with a flexible name region, not HTML table markup. The new-client and permissions editor reuses labeled `.settings-row` controls for name, folder scope, individual capabilities and numeric budgets. Read file contents remains a separate visible checkbox from metadata and navigation permissions. Unattended execution unavailable and Terminal input unavailable remain visible as disabled, unchecked checkboxes with their explanations. Read terminal output names its separate terminal-read grant requirement.

After client creation, a short one-time-credential explanation precedes a conditionally displayed, read-only `.agent-configuration` textarea. It retains the Settings field surface, border, rounding and selectable text; focus selects its contents. Recent activity is a disclosure with muted timestamps and tool/status lines. The original dark screenshot verifies the named client rows and beginning of the editor; the safety captures verify disabled capability rows at desktop dark and compact light. Configuration and activity presentation remain source-derived.

### Protected Action Review

Run action states the captured selection, chosen recipe, recursion and relevant provider/data context. Create proposal leads to review before any file change. Tasks/Review appears in the titlebar only while work needs attention; its task list names the status and change count.

Review rows show the source filename, completion/conflict/error information, an approval checkbox, and the destination Name field. The filename is editable by default; a quieter `In [directory]` line preserves destination context. Edit path explicitly switches that row to full-path input; Edit filename returns it. Filename mode rejects folder separators and directs the user to Edit path. Evidence is available per row in a bounded lower section, including an explicit absence of document evidence.

Select available changes skips unresolved issues. Apply names the approved count and stays unavailable with no selected changes. Applying/busy states prevent duplicate submissions; cancellation, partial/interrupted recovery, and guarded Undo changes remain visible when applicable. Summary export first chooses a folder and name, then creates a reviewable file-change proposal. Provider or agent recipe output never silently applies changes.

**The Proposal Review Rule.** Put filename changes, directory context, row approval and evidence together; require explicit Apply for every file-change proposal and expose guarded Undo or recovery when available.

### Content Checkpoints

The review footer adds an initially unchecked Keep a content checkpoint option (`.checkpoint-choice`) before Apply. It uses a compact grid (4px gap), the compact body size (12px), a maximum width (440px) and automatic right margin. When selected, estimated bytes, available storage and the file-contents/mode limitation appear as wrapping muted lines beneath the checkbox; the dark review screenshot shows this chosen state. The option does not add a second action style.

Content checkpoints uses the existing narrow dialog and project-control rows. The source places storage usage and the excluded metadata explanation above the records. Each `.checkpoint-record` wraps its title/date/size region onto a full-width first line, followed by Restore to folder… and Remove; Done remains in the footer. Loading, an empty explanation, disabled controls and the shared error treatment use existing roles. This manager has no supplied standalone screenshot.

### Comparison and Operation Review

Compare locations places equally weighted Left location and Right location fields above the initially unchecked content-reading option. That option names SHA-256 comparison and explains possible provider downloads in smaller muted text. The result summary gives entry count, traversal coverage and selected count. The divided `.comparison-row` grid keeps relative path primary, with Left size, Right size and textual Status columns. Open left/Open right actions sit beneath the path. Column headings use compact muted text (12px); no new status palette is introduced.

The comparison result container explicitly uses `role="table"`, labeled Comparison results, with `aria-rowcount` including the header. Its heading row exposes five `columnheader` roles, including the selection column, and each result row exposes corresponding `cell` roles. This is source-verified semantic markup, not a claim of screen-reader runtime verification. The footer keeps Close/Stop, Compare and Review copy to right… together.

Operation review uses a selected-count explanation above Select all changes and Clear selection. Each divided `.operation-review-row` pairs a selection checkbox with a flexible stack of strong operation/filename, muted source path and labeled destination fields. Name is editable for rename/create-folder rows; Destination folder appears when applicable. An initially unchecked Save a content checkpoint first option (`.review-checkpoint`) sits within the body above Cancel and the counted Apply action. Its explanation uses the same compact muted text as the comparison permission option. Paging preserves the existing row-selection controls without inventing a separate navigation treatment.

### Collections and Basket

Collections and basket uses the shared wide dialog and `.project-control-row` dividers. A strong basket count and Clear basket precede wrapping path references with Remove actions. Review copy…, Review move… and Refresh source versions use an ordinary action group. A full-width Collection name field precedes Save basket as collection; New query collection is a native disclosure with query, folder and a separate Search indexed file contents choice. Named collections pair a strong name and muted reference count/query with Open plane and Remove. The body scrolls while Done remains in the separated footer.

The collection plane's actual source reuses `FileTable` and `ListView`, rather than a custom collection grid. Its `.search-row` names the collection and explicit/query context, followed by Refresh and Add selection/collection to basket. Shared configurable file columns, header alignment, selected metadata colors and dense row treatment come from the existing file-list system. Rows retain listbox/option selection semantics. A `.collection-issues` disclosure has a bounded scroll area (120px), and the ordinary folder-status footer reports file/selection counts and reference or query-snapshot context. The supplied image obscures this plane; its layout and error disclosure are source-derived.

### Workflows

Workflows starts with the ordinary Open workflow… action, a labeled template selector and Create…. A definition uses native `details`/`summary` (`.workflow-definition`), retaining its disclosure marker through `display: list-item`. Its summary pairs the strong workflow name with the muted file path. Opening a definition leaves execution behind the explicit Run workflow action. Expanded contents use ordered step IDs with quieter kind/dependency text, ordinary binding rows and the existing Run/Edit/Reload/folder-permission actions.

Runs use full-width `.workflow-run-choice` buttons with a strong name on the left and quieter status/date on the right. `aria-pressed` identifies the selected run; selection uses the existing fill, ink and selected-metadata roles. The selected-run section lists each step and textual state. Needs review exposes Review copy… or Review recipe… through the established review flow. Resume workflow, Cancel run and Remove run history use ordinary buttons whose availability follows the run state. They add no status-specific palette or new command style.

Edit definition reveals a labeled Workflow JSONC textarea (`.workflow-editor`) within the native definition disclosure. It uses the shared field/ink/line colors, control radius (5px), accent caret and an inset (10px 12px), with the source monospace fallback and line height (1.55). The field resizes vertically from a minimum height (220px). Focus changes its border to accent and retains the absence of outlines and halos. Cancel editing and Save definition use the existing action group. The dark and light editor captures verify this field treatment.

`WorkflowArtifact` reuses inspection details: native file disclosures show filename and Metadata/content coverage, then the complete path, existing fact grid and evidence-passage buttons when present. The comparison artifact reuses the same fact grid for coverage and status counts; this variant is source-derived. Completed copy/recipe steps show a plain muted `.workflow-receipt` paragraph. That receipt and the following output-reference count occupy separate lines: the receipt has a 6px top margin, and `.workflow-steps li > small` is block-level with its own 6px top margin. The light completion capture verifies that separation. No additional artifact card, color system or preview typography is established.

### Related Files

Related files starts with the complete muted file path, pressed-state List/Map controls, Refresh and an initially unchecked Read local references in this file choice. List records place the strong relationship kind beside its muted basis, followed by From/To filename buttons, full paths, textual version status and Open in plane actions. Shared labels identify Recorded operation, Declared link, User note and Suggested link; the captures show recorded-operation and user-note examples, while the other label mappings are source-derived. Add a relationship note is a native disclosure with a Related file path field, a required Note textarea and Save relationship note. The textarea inherits the body font and existing field, ink, line, control-radius and accent-caret roles, with a 10px by 12px inset. Saved notes expose Remove note within their record.

The map uses neutral, line-bordered file rectangles (240×48px, 5px rounding), system body text and smaller parent context (11px). The current file uses selection fill, ink and selected-metadata text; other nodes use the field surface and muted parent text. Muted arrows show direction, and suggested links use a dashed stroke in source. Beneath the SVG, `.relationship-map-links` pairs each displayed link's strong kind with its explicit basis and a From/to endpoint line. This text list and the diagram filter to the same endpoint set. Parent labels retain their trailing context when shortened, keeping the final destination folder visible for duplicate basenames. Native HTML buttons under Explore diagram files provide node exploration with filename, parent context and complete-path tooltip; the SVG itself is labeled as a diagram, not used as an interactive button surface. The light map verifies the basis/kind labels and duplicate-name context; screen-reader runtime remains unverified.

### Watch Rules

Watch rules is a section within Workflows, using the existing 14px heading and `.watch-rule-row` line dividers. A strong rule name sits above its muted folder path, with Paused, Watching, Running or Needs review expressed as ordinary text. Open run and Pause use the existing action group. A paused rule exposes Review and enable… and Remove rule. Reviewing returns to a native disclosure named Review watch rule with the saved scope visible before the explicit Enable watch rule action.

The approval form names the workflow and explains that new or changed files feed the run, existing files are skipped when enabling, and copies/renames wait for review. Watched folder and Choose folder… precede File extensions, Include subfolders, the separate Allow local content inspection checkbox and Minimum time between runs. The content explanation states its input/output scope, possible cloud downloads and manual model recipes. Cooldown choices are 30 seconds, 1 minute and 5 minutes. Fields, checkbox labels, muted explanations, Cancel and primary Enable reuse the existing controls; the scope is an approval surface and does not approve subsequent file mutations. The dark and light approval captures verify this form, and the light waiting-review capture shows Open run/Pause followed by the selected run and Review copy… in the existing review flow.

### Agent Command Review

Agent command and configuration proposals use the existing wide modal dialog. The title names the requested action; supporting text states its agent origin, captured directory and selection. A bounded, wrapping monospace area shows the command/executor or configuration patch. The footer pairs Reject with Run action or Apply changes. Every command opens a fresh review; saved grants cannot bypass it. Agent shell scripts, executables, terminal profiles/input, external-app commands and file Undo are unavailable. Recipe file proposals retain their separate row review and Apply.

File and folder removal uses Move to Trash in both the title and primary action. The detail lists every exact path, including items beyond the eight-name selection summary, and states that selected folders include their contents, nothing is permanently deleted and approval applies only to this request. The wide dialog keeps its existing neutral surface, system title and compact monospace detail. Its body scrolls with the dialog inset (18px), while the header and Reject/Move to Trash footer stay fixed and reachable. The detail retains its own bounded scroll area (45vh maximum height), selectable text and path wrapping. Long scope must remain reviewable through the last path and consequence before approval.

The supplied [agent safety acceptance evidence](packages/viewer-electron/app/out/agent-safety-acceptance-qChZqY/result.json) records four passing native reject-only checks and ten valid captures: desktop/compact dark and light Trash review, long-scope top/bottom compact light, desktop/compact light Agent permissions, and desktop dark/compact light client controls. Thirteen in-memory security regressions also passed. Finish review: ship, with clipping and approval completeness resolved. No detector ran. Positive native Trash, physical approval, assistive technology and Mac App Store qualification remain unverified.

### Terminal Planes and Command Output

Terminal planes retain the ordinary titled header and frame/dock/more/close controls. An inset content stage (8px) contains the xterm screen, with a compact search control aligned at the upper right and an on-demand field. Terminal keys and wheel input belong to the terminal; Command-K and Settings remain application commands. Quoted file drops paste paths. Local panel dimensions set rows and columns, while camera zoom and rotation preserve them. Screen state and its shell survive spatial detachment and workspace switches during the running app; restart opens a fresh shell.

Custom-process output appears in a bounded lower-right panel (at most 560px wide and 55% high), using the existing neutral surface, line border and menu rounding. Output wraps within its own scroll area, with status and cancellation beside the command. Completion or failure names the captured action rather than implying the selected plane was retargeted.

### Preview Content

Images, supported audio/video, PDF, text/code/Markdown/JSON/CSV, models and archives keep their established local-content stages and scoped controls. EPUB joins the same preview family with a toggleable contents column (200px), chapter navigation/count, and adjustable reading text. Chapter content scrolls in the existing document inset (24px 32px) and line spacing (1.7). Source headings remain document hierarchy; unsupported content and extraction limits receive plain feedback. These previews derive their visual substance from local files.

Model stages use neutral ambient fill and key/fill lights attached to the model camera, preserving readable reverse faces during orbiting. The hemisphere follows the stage's up axis, and CAD material colors enter the renderer as linear RGB. Dimensions and surface measurements retain the source geometry and units.

### Model Shading

Shading is an ordinary selected/expanded toolbar button in Quick Preview and the linked preview header. It opens the bounded stage panel with Surface and Lighting selects, a Brightness range and percentage output, Show edges and Shadows checkboxes, and Reset shading. The fields use existing system type, neutral surfaces, border/caret roles and compact gaps (12px between controls, 6px inside labels). Close shading controls and Escape close only this panel and return focus to Shading. Pointer and wheel events within the panel stay with its controls rather than the model camera.

Surface offers Original materials, Clay and Normals. Lighting offers Studio, Contrast and Soft. Contrast is the default, with brightness at 85%, edges off and self-shadows on; its lower ambient fill and exposure preserve recess detail. Brightness spans 40–160% in five-percentage-point steps. Normals disables lighting, brightness and shadows while retaining their saved settings. Edges applies to rigid meshes; animated/deforming meshes receive a plain limitation note directing users to Wireframe. Reset shading restores the default appearance.

**The Presentation Rule.** Persist model appearance separately from its camera and update the live stage without reimporting the file or changing source materials, textures, geometry, units or dimensions.

The [native model/navigation result](packages/viewer-electron/app/out/model-navigation-acceptance-MigAQR/result.json) verifies live STEP/STL appearance changes with unchanged source bytes and dimensions, Escape behavior, and linked appearance/camera persistence after cold restart. The [Studio panel](.impeccable/review/models-links-trash-v3/model-navigation-acceptance-MigAQR/step-studio-controls-dark.png), [Normals state](.impeccable/review/models-links-trash-v3/model-navigation-acceptance-MigAQR/step-normals-dark.png) and [compact light panel](.impeccable/review/models-links-trash-v3/model-navigation-acceptance-MigAQR/step-controls-compact-light.png) show the current field, disabled and scrolling treatments. These are file-preview controls within the existing world; they establish no new shell palette or model-editing workflow.

### PDF Previews

[PDFPreview](packages/viewer-electron/app/src/renderer/previews/modules/PDFPreview.tsx) keeps the incumbent neutral controls and white page stage. Fit page is the default in Quick Preview and linked planes. Fit width remains an explicit choice; percentages use actual CSS document scale and stay fixed across resizing. Explicit choices persist under `pdf.view`; the old width-relative `pdf.zoom` value is ignored. [Viewport sizing](packages/viewer-electron/app/src/renderer/previews/pdf-viewport.ts) includes page rotation.

**The PDF Fit Rule.** Fit the whole page to both content-box dimensions by default; recalculate fitting after resize, search-row changes, page changes and rotation, while preserving explicit Fit width or CSS-percentage choices.

The supplied [PDF acceptance evidence](packages/viewer-electron/app/out/pdf-acceptance/result.json) records five passing owned-native checks and seven valid captures: wide/compact dark PDFs, compact search and rotation, desktop/compact light PDFs, and the context menu with both icons visible. Finish review: ship, with no material fixes required. No detector ran; native permissions, assistive technology and Mac App Store qualification are outside this evidence.

### Office Previews

[OfficePreview](packages/viewer-electron/app/src/renderer/previews/modules/OfficePreview.tsx) follows `office-preview-v1` within the existing file plane. DOCX paragraphs, source headings and tables use the shared type and theme roles. The centered body has a readable measure (74ch), document inset (24px 32px 48px) and line spacing (1.7); tables scroll horizontally when needed. Original block citations scroll to the passage and mark it with selection fill and an accent outline.

XLSX keeps the native Worksheet selector, including `(hidden)` labels, in the contextual header. The shared [DataTable](packages/viewer-electron/app/src/renderer/previews/DataTable.tsx) uses virtual rows (32px), lettered columns with a minimum width (140px) and a sticky source-row column (48px). Filter rows preserves original row numbers and cell addresses. Selecting a cell reveals its saved value and formula, or No saved value, in the wrapping detail strip. Formulas remain text and are not recalculated.

Preview details is an ordinary header button with expanded/control semantics and a scoped Show/Hide preview details command. Coverage and formula counts appear in a nonshrinking inline body section, outside header clipping. The [renderer styles](packages/viewer-electron/app/src/renderer/styles.css) retain the shared raised surface, line divider and compact type. Loading and unavailable previews reuse the incumbent primitives; unavailable content offers Open in Default App.

**The Office Source Address Rule.** Preserve original DOCX block citations and worksheet cell addresses; filtering keeps source row numbers, and formula details distinguish saved values from missing cached values.

The supplied [Office acceptance evidence](packages/viewer-electron/app/out/office-acceptance/result.json) verifies four packaged checks and settled, fully opaque captures: Word in dark/light and compact light, workbook formulas/filtering in dark/light and compact light, hidden/empty sheets in compact light, and unavailable recovery in dark. The Office finish disposition is ship, with coverage clipping resolved and the compact Word capture supplied. Loading capture, physical assistive technology, genuine native pickers and Store acceptance gates remain unverified.

### Operations

The operations control appears for pending work, conflicts, or unseen failures. Its anchored popover shows bounded progress, cancellation, paths, errors, and available undo; past jobs open through Commands or the native menu. Conflicts provide Skip, Keep both, and Replace, with an explicit remaining-conflicts checkbox. Replace explains that the existing item goes to Trash and requires its own confirmation. Idle browsing keeps the workspace open.

### Menus and Feedback

Searchable context actions render through body portals with viewport-bounded overflow. Dialogs use native modal focus behavior; transient surfaces restore focus to their initiating control when it remains available. Focus rings and halos are suppressed across app and engine chrome; keyboard-focused controls use the raised surface and accent text, with the same treatment on a focused checkbox's label. Carets, active-command surfaces, selected files and drag/drop feedback remain visible. Errors use the danger role and wrap long paths. Empty/loading views use SVGs, plain task text, and the existing type hierarchy. Session workspace recovery is a compact transient status with Undo, rather than permanent window chrome.

The [context-menu mapping](packages/viewer-electron/app/src/renderer/commands/menu.ts) gives Workspace the existing command glyph and Project the existing folder glyph, keeping both distinct within the incumbent icon system.

Dialog Close icon focus (`.dialog .icon-button:focus-visible`) uses the selection fill and normal ink, with no outline or shadow halo. The reviewed comparison, operation-review and collection-manager screenshots show this filled control. Ordinary dialog buttons and checkbox labels retain the existing raised-surface/accent focus treatment.

## Do's and Don'ts

### Do:

- Do coordinate the shell, engine, and preview look through the shared surface and text roles.
- Do preserve dense file rows and readable selected metadata across list, grid, and gallery.
- Do use authored SVG icons, accessible action labels, keyboard navigation and visible active-command feedback.
- Do keep one contextual header per plane, scoped frame/dock commands reachable, and plane dragging on the title region.
- Do bind commands to an explicit target and show only applicable results, with an active result and useful empty states.
- Do keep appearance and spatial aids in Settings, and show operations only when work or explicit history needs attention.
- Do preserve the modeless Settings window's dimensions across all eleven categories, live updates, and close-flush behavior.
- Do show filenames before directory context in finding and proposal review, with a deliberate Edit path mode for folder changes.
- Do require row approval and explicit Apply, show evidence, and retain guarded Undo/recovery for file-change proposals.
- Do keep content indexing, provider text permission, recipe data limits and authorized agent folders explicit in their respective controls.
- Do keep the terminal-read grant beside its folder scope, require fresh approval for every agent command, and keep effective grants outside editable configuration.
- Do name every exact removal path and selected-folder contents before Move to Trash, and keep Reject and the approval action reachable while long scope scrolls.
- Do preserve terminal input ownership and each root's independent sessions within the existing plane grammar.
- Do extend reusable recipe, provider and agent editors with the existing system font and surface tokens.
- Do state layout-only consequences for sidebar/workspace actions and the Trash consequence before replacing a file.
- Do retain file-content conventions such as syntax coloring, contained imagery, Markdown quotation borders and EPUB chapter hierarchy.
- Do wrap project names, inspection paths and evidence within their available width while keeping row actions and dialog footers reachable.
- Do keep project recovery in normal flow, offer Close project for missing definitions and retain open workspace content when detaching the association.
- Do use the shared body font and field roles for plane notes, and keep the content-reading choice explicit in file inspection.
- Do keep Shading inside the model stage, preserve its compact scroll area, and save presentation separately from the model camera.
- Do show linked-child markers beside file identity and retain docked or spatial presentation when returning to an existing plane.
- Do keep Trash inventory read-only, distinguish unavailable from empty, and leave its count and ordinary footer actions reachable.
- Do distinguish macOS Full Disk Access recovery from exact-folder authorization, using Open Privacy Settings… for privacy denial and Allow folder access… for FILE_ACCESS_REQUIRED.

### Don't:

- Don't introduce a separate decorative identity or display-font tier into this confirmed application family.
- Don't reintroduce the wordmark/tagline, plane tabs, global arrangement toolbar, theme button, shortcut footer, or persistent operations rail.
- Don't add focus rings or halos; preserve keyboard navigation, input carets and selected/active-result feedback.
- Don't offer a plane-backs visibility setting or turn off backs; retain the configurable native spatial controls.
- Don't apply model or agent recipe file proposals without row approval and protected in-app review.
- Don't let saved execution grants or hidden manual confirmation preferences bypass fresh approval for an agent removal.
- Don't treat local agent authentication as a provider credential or make agent startup use Keychain.
- Don't place duplicate floating engine controls over preview actions.
- Don't make file content or model gestures drag the plane instead of performing their own task.
- Don't reuse dark syntax colors unchanged in light previews or use ordinary muted text on dark selected files.
- Don't turn synthetic verification fixtures into shipping product imagery.
- Don't let Shading reimport or alter source models, materials, textures, units or dimensions.
- Don't expose Trash erasure or approval through renderer commands, shortcuts, MCP, scheduled routes or editable grants, or let a coding agent select or approve Empty Trash.
- Don't treat fixture-based populated Trash renders or no-op guard checks as positive native emptying, post-grant browsing or Store qualification.
- Don't offer Reload for a missing project definition, cover the docked toolbar with its warning or imply that selecting a hidden Trash folder grants macOS Full Disk Access.
