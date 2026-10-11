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
rounded:
  control: '5px'
  tile: '6px'
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
- A separate searchable Settings window with stable dimensions and live preferences.
- Filename-first finding and proposal review with explicit scope, evidence, and Apply/Undo.
- File-content previews within the same visual system.

Extracted from [renderer styles](packages/viewer-electron/app/src/renderer/styles.css), [engine looks](packages/viewer-electron/app/src/renderer/workspace/look.ts), [window chrome](packages/viewer-electron/app/src/renderer/App.tsx), [plane headers](packages/viewer-electron/app/src/renderer/workspace/PlaneHeader.tsx), [shared commands](packages/viewer-electron/app/src/renderer/commands/registry.ts), [sidebar](packages/viewer-electron/app/src/renderer/ui/Sidebar.tsx), [Settings](packages/viewer-electron/app/src/renderer/ui/Settings.tsx), and [file views](packages/viewer-electron/app/src/renderer/explorer/views.tsx). [PRODUCT.md](PRODUCT.md) is the confirmed authority for the incumbent family and desktop constraints.

The current extension also follows [the first-child direction contract](packages/viewer-electron/app/index.html), [native Settings lifecycle](packages/viewer-electron/app/src/main.ts), [filename finder](packages/viewer-electron/app/src/renderer/commands/CommandPalette.tsx), [virtual search roots](packages/viewer-electron/app/src/renderer/explorer/SearchExplorer.tsx), [action review](packages/viewer-electron/app/src/renderer/actions/ActionHub.tsx), and [EPUB preview](packages/viewer-electron/app/src/renderer/previews/modules/EPUBPreview.tsx). It extends the incumbent through code; no approved visual comp supplies a replacement identity.

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

**The Shared Look Rule.** Apply the selected look to both the shell and the spatial engine; extend previews with the same surface and text roles.

**The Selected Metadata Rule.** Use the selected metadata role on selected rows, tiles, and gallery items so secondary information stays readable against selection.

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

Use tabular numerals for file sizes and operation counts. File and plane names truncate to one line; error text and document content can wrap. Markdown and EPUB headings belong to the displayed document and retain their content hierarchy. EPUB reading text starts at 17px with a user-adjustable size; it does not establish a new application display face.

**The Content Hierarchy Rule.** Keep document headings and syntax styling inside previews; extend application chrome with its compact title, body, and label roles, and use the established Settings heading roles within that separate window.

## Layout

The shell fills the native window. The draggable titlebar (56px) reserves the left inset for macOS window controls (94px). It contains window navigation visibility, the searchable workspace selector, a compact plus for a new root folder plane, conditional operations/action tasks, and Commands. The window has no in-window wordmark, tagline, plane tabs, global arrangement toolbar, theme button, or global shortcut/count footer. Buttons remain outside the native drag region.

The visible sidebar starts at its saved/default width (210px), resizes within its bounds (160–360px), and can hide completely. Folder planes show the shared navigation component by default, with a direct header toggle and independent width/visibility; its actions navigate that plane. Shortcut order, aliases, Favorites and section folding are shared. Window navigation starts hidden and remains optional. Settings controls navigation in later new planes. The projected resizer handles spatial zoom and perspective, and caps rendered navigation at half a narrow plane’s content width. Sidebars and plane bodies scroll independently of their chrome. The native window minimum is implemented (780×560). Adapt to available workspace and plane dimensions rather than switching to a phone navigation pattern.

Every plane has one contextual header (40px), with compact icon actions (28px). A plane-width container query (540px) hides forward navigation, frame/dock icons and secondary preview labels, and narrows the preview control slot from 64% to 50%; that slot can scroll horizontally. Titles retain ellipsis. Path entry, breadcrumbs/filtering, folder search, and secondary actions appear on demand. Search toggles from the header and clears/cancels its query on close. Scoped commands keep actions available when compact chrome hides them.

Automatic planes follow the measured workspace: width is bounded from 380px to 960px with 32px of horizontal clearance; height is bounded from 300px to 660px with 72px of vertical clearance. Manual resizing is configurable. Framing waits for the live viewport and measured planes to settle. Opening normally faces the new plane; Settings offers linked-pair framing or docking. An existing path/type focuses its plane within the originating root while retaining its link and position; the same file opened from another root keeps a separate preview. Open another plane creates an explicit copy. Refitting preserves deliberate camera movement. Reopening keeps a usable saved view and brings a clipped active plane into view. Explicit consolidation of repeated previews keeps the active placement, protects deliberate copies and branches, and offers one-step arrangement undo.

File lists use virtualized rows (36px comfortable, 30px compact), with a flexible name column and fixed metadata columns. Headers and rows share grid padding and a stable scrollbar gutter. Name aligns with filename text after its icon; date and kind align left, size right. Plane-width queries remove kind at 650px and date at 470px in both folder and search headers, retaining file identity and size. Grid and gallery use contained thumbnails and truncated file names; columns retain separate scrollable folder lists. Small control gaps and the repeated frontmatter spacing steps keep chrome compact. Dialog content uses the larger panel/dialog steps.

Transient surfaces remain bounded by the native viewport. Searchable context actions use a compact width (304px); the command palette is wider (560px). The palette anchors its top edge at 22% of the window height, bounded to 80–240px, and keeps its search field stationary as results grow downward. Its result list scrolls before reaching the bottom clearance (20px). The operations popover anchors below the upper-right control (370px wide, 64px from the top, 16px from the right) and scrolls within the window. It never consumes workspace width.

An empty workspace offers New folder plane directly and Open folder… as a secondary action. Its New planes start in selector edits the same preference as Browsing settings: current folder, Home, standard locations or a custom folder. Current folder uses Home when the workspace is empty. A custom folder uses the native picker; the empty screen names that folder and Settings shows its full path beside Change folder…. Cancelling keeps the previous choice.

Settings occupies a separate modeless native window: default outer size 900×640px, captured macOS content size 900×612px, and minimum outer size 760×540px. Category changes keep the window size stable; user resizing and the last category persist. The content uses a navigation column (190px) and a flexible page. Navigation and page scroll independently, with the page's recorded inset (28px 32px 40px) and a stable gutter so expanded recipe editors never move fields horizontally.

Quick Preview combines quiet module/size metadata, previous/next navigation and its two open actions in one footer. The default-open button names the OS application, such as Open in Code, and falls back to Open when no name is available. Long application names truncate visually while retaining their complete tooltip. File identity stays in the dialog title; no second metadata footer or external-open icon repeats those actions.

Proposal review is a bounded modal surface, with width `min(920px, calc(100vw - 80px))` and height `min(700px, calc(100vh - 90px))`. Context, selection, evidence, and footer surround a scrollable virtual row area. Each row gives the editable filename the available width; the directory is quieter context below it. Virtual search roots use the folder list layout and a local result status/paging strip within their own plane.

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

The dense row separates file identity from muted date, kind, and size metadata; file sizes align right. Hover uses the raised surface; selection changes the row and its metadata together. Alias overlays remain visible at native file-icon size. Grid and gallery carry the same file-selection treatment.

### Contextual Plane Header

Folder headers combine a direct navigation toggle, back/forward navigation, a titled drag region, view menu, search, frame/dock, more actions, and close. Preview headers replace folder navigation/view/search with the module's primary controls in the same header. There is no second permanent preview toolbar in a linked plane. The first title press selects and moves the plane; pressing an already selected plane retains the current multiselection. File selection, text selection, media, image, and model gestures keep their own functions. Duplicate floating engine controls remain disabled.

Images, models, PDF, text, and media contribute commands scoped to their preview. Keep zoom, fit, page, search, and playback actions with the preview they affect; unavailable actions do not appear as command results. Supplemental file information stays compact within the plane body.

### Searchable Actions

Command-K and autofocus right-click actions share the typed command registry, row appearance, and keyboard navigation. Action rows pair an SVG and label with optional detail and shortcut. Search retains focus while the active result uses the selection surface and selected metadata role. Arrow keys, Home/End, Enter, and Escape navigate, invoke, and dismiss. Aliases such as `rn`, `cp`, and `nf` rank the corresponding action; at most two applicable recent IDs appear once, without duplicate or unavailable results.

Targets remain explicit: a context menu binds its clicked item or captured selection; Commands reflects the active context. Pointer hover updates the active result without forcing scroll; keyboard movement scrolls that result into view, and a changed query returns to the top. Menu scroll is contained. Copy/Move to continues through a destination step. Empty searches state that no actions/files match, and folder reading or errors receive their own readable feedback.

### File Finding and Virtual Search Roots

Command-F opens the same compact searchable result pattern with filename as the primary label and a quieter parent-directory detail when needed. Its scope select names This folder, Subfolders, and Indexed locations. Folder scope ranks the current listing; subfolder scope searches the subtree; Indexed locations and Document text use the local background index. Scope and document-text permission stay visible alongside Open results and Save search. Text indexing requires a separately enabled location in Settings → Search; unavailable or incomplete indexing receives inline feedback.

Open results creates an independent virtual root; saved searches use the same root pattern when reopened. Its header and query/scope row belong to that plane. Results retain ordinary file selection, file commands, context actions, drag, and Quick Preview; opening a result links its preview to this search root. The result strip shows indexing status or the current page with Previous/Next. Search selection and cached file identity use the same browsing sessions as folders.

**The Search Scope Rule.** Keep filename identity primary and search scope explicit; distinguish local names/metadata from separately granted document-text indexing, and present search results as file-capable virtual roots.

### Settings

Command-comma opens or focuses the separate modeless Settings window. Its searchable categories are Browsing, Navigation, Previews, Space, Search, Actions, Models, Agents, and Shortcuts. A selected category uses the selection surface; typed queries search labels, details, and category names, with discovery links for service editors. Native titlebar controls close the window. Category/page changes preserve its size. Preference changes update the main window live; text fields commit on blur, the reusable single-line text editor also accepts Enter, and native close blurs the active field and flushes queued writes.

Browsing carries System, Dark, and Light appearance, default view, density, hidden-file and restore preferences. Navigation uses the shared section/shortcut language. Space keeps face-on opening, headers, title dragging, resize handles and all three native spatial aids on by default; transform origin stays off. Plane backs are always visible with no option. Search lists indexed locations with status/counts, per-location Contents grants, add/remove, pause/rebuild, saved queries and exclusions. Long paths wrap within the flexible content column.

Actions uses expandable recipe rows and a reusable label/field editor for name, type, formats, recursion, template, instructions, provider, permitted data, and shortcut. Filename templates stay visible for naming actions. New, duplicate, import, export, and applicable removal controls use ordinary compact buttons. Recipe configuration does not bypass proposal review.

Models names each provider, endpoint and model, with an explicit Connect and load models action and a separate document-text permission. Password fields show whether a key is stored and offer Clear stored key. No provider is enabled by default. Provider keys use protected desktop storage only through explicit credential operations. Agents is opt-in, lists authorized folders with revocation controls, and generates selectable local MCP configuration only when enabled with a folder grant. The local agent token stays in private app metadata and does not use Keychain. Agent proposals enter the same review surface; clients cannot Apply, Trash, or delete files. Keep permissions near the service they affect.

Shortcuts uses labeled editable bindings and a reset action; recipe bindings remain in Actions. Space remains Quick Preview. Model settings, agent configuration, and shortcut syntax belong in these configuration flows.

**The Settings Window Rule.** Keep Settings modeless, searchable and stable across categories, with live updates and close-flush; extend its editors with the shared system fonts, neutral surfaces and ordinary controls.

### Protected Action Review

Run action states the captured selection, chosen recipe, recursion and relevant provider/data context. Create proposal leads to review before any file change. Tasks/Review appears in the titlebar only while work needs attention; its task list names the status and change count.

Review rows show the source filename, completion/conflict/error information, an approval checkbox, and the destination Name field. The filename is editable by default; a quieter `In [directory]` line preserves destination context. Edit path explicitly switches that row to full-path input; Edit filename returns it. Filename mode rejects folder separators and directs the user to Edit path. Evidence is available per row in a bounded lower section, including an explicit absence of document evidence.

Select available changes skips unresolved issues. Apply names the approved count and stays unavailable with no selected changes. Applying/busy states prevent duplicate submissions; cancellation, partial/interrupted recovery, and guarded Undo changes remain visible when applicable. Summary export first chooses a folder and name, then creates a reviewable file-change proposal. Provider or agent output never silently applies changes.

**The Proposal Review Rule.** Put filename changes, directory context, row approval and evidence together; require explicit Apply for every file-change proposal and expose guarded Undo or recovery when available.

### Preview Content

Images, supported audio/video, PDF, text/code/Markdown/JSON/CSV, models and archives keep their established local-content stages and scoped controls. EPUB joins the same preview family with a toggleable contents column (200px), chapter navigation/count, and adjustable reading text. Chapter content scrolls in the existing document inset (24px 32px) and line spacing (1.7). Source headings remain document hierarchy; unsupported content and extraction limits receive plain feedback. These previews derive their visual substance from local files.

### Operations

The operations control appears for pending work, conflicts, or unseen failures. Its anchored popover shows bounded progress, cancellation, paths, errors, and available undo; past jobs open through Commands or the native menu. Conflicts provide Skip, Keep both, and Replace, with an explicit remaining-conflicts checkbox. Replace explains that the existing item goes to Trash and requires its own confirmation. Idle browsing keeps the workspace open.

### Menus and Feedback

Searchable context actions render through body portals with viewport-bounded overflow. Dialogs use native modal focus behavior; transient surfaces restore focus to their initiating control when it remains available. Focus rings and halos are suppressed across app and engine chrome; carets, active-command surfaces, selected files and drag/drop feedback remain visible. Errors use the danger role and wrap long paths. Empty/loading views use SVGs, plain task text, and the existing type hierarchy. Session workspace recovery is a compact transient status with Undo, rather than permanent window chrome.

## Do's and Don'ts

### Do:

- Do coordinate the shell, engine, and preview look through the shared surface and text roles.
- Do preserve dense file rows and readable selected metadata across list, grid, and gallery.
- Do use authored SVG icons, accessible action labels, keyboard navigation and visible active-command feedback.
- Do keep one contextual header per plane, scoped frame/dock commands reachable, and plane dragging on the title region.
- Do bind commands to an explicit target and show only applicable results, with an active result and useful empty states.
- Do keep appearance and spatial aids in Settings, and show operations only when work or explicit history needs attention.
- Do preserve the modeless Settings window's dimensions across all nine categories, live updates, and close-flush behavior.
- Do show filenames before directory context in finding and proposal review, with a deliberate Edit path mode for folder changes.
- Do require row approval and explicit Apply, show evidence, and retain guarded Undo/recovery for file-change proposals.
- Do keep content indexing, provider text permission, recipe data limits and authorized agent folders explicit in their respective controls.
- Do extend reusable recipe, provider and agent editors with the existing system font and surface tokens.
- Do state layout-only consequences for sidebar/workspace actions and the Trash consequence before replacing a file.
- Do retain file-content conventions such as syntax coloring, contained imagery, Markdown quotation borders and EPUB chapter hierarchy.

### Don't:

- Don't introduce a separate decorative identity or display-font tier into this confirmed application family.
- Don't reintroduce the wordmark/tagline, plane tabs, global arrangement toolbar, theme button, shortcut footer, or persistent operations rail.
- Don't add focus rings or halos; preserve keyboard navigation, input carets and selected/active-result feedback.
- Don't offer a plane-backs visibility setting or turn off backs; retain the configurable native spatial controls.
- Don't turn model or agent output into applied file changes without the protected in-app review.
- Don't treat local agent authentication as a provider credential or make agent startup use Keychain.
- Don't place duplicate floating engine controls over preview actions.
- Don't make file content or model gestures drag the plane instead of performing their own task.
- Don't reuse dark syntax colors unchanged in light previews or use ordinary muted text on dark selected files.
- Don't turn synthetic verification fixtures into shipping product imagery.
