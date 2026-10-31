---
name: Viewer
description:
  The current Plurid application system for dense file browsing and linked spatial previews.
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
  syntax-comment: '#9fabb9'
  syntax-function: '#82b3cf'
  syntax-selector: '#b7c79e'
  syntax-property: '#82b3cf'
  syntax-attribute: '#dfb891'
  syntax-operator: '#c9b4d6'
  light-syntax-string: '#386731'
  light-syntax-keyword: '#755183'
  light-syntax-number: '#805d32'
  light-syntax-comment: '#637084'
  light-syntax-function: '#337396'
  light-syntax-selector: '#386731'
  light-syntax-property: '#337396'
  light-syntax-attribute: '#805d32'
  light-syntax-operator: '#755183'
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
  reading-preview:
    fontFamily: 'Menlo, ui-monospace, SFMono-Regular, monospace'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: '20px'
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
  task-request-dialog:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.dialog}'
    width: 'min(580px, calc(100vw - 32px))'
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
    height: '40px'
  trash-inventory-heading:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.muted}'
    typography: '{typography.body-compact}'
    padding: '0 20px'
    height: '42px'
  button-secondary:
    backgroundColor: '{colors.field}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '6px 10px'
  button-danger:
    textColor: '{colors.danger}'
    rounded: '{rounded.control}'
    padding: '6px 10px'
  setting-row:
    typography: '{typography.body}'
    height: '40px'
  setting-row-compact:
    height: '32px'
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.menu}'
    padding: '12px'
  popover:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.menu}'
    padding: '12px'
---

# Design System: Viewer

Viewer uses the Plurid application family: compact native-feeling controls, dense file views and a
quiet workspace. The goal is readable work and obvious actions. The token catalog above records
current light/dark roles; source styles remain the implementation authority.

## Reading and hierarchy

Use the platform system sans for application controls. Keep headings compact and reserve emphasis
for file identity, selection, active context and primary actions. Read-only source defaults to 16
px; editor and terminal metrics are separate preferences. Terminal defaults follow the configured
terminal face. Source typography belongs inside rendered Office/PDF/HTML content, not in app
controls.

Use shared surface, ink, muted, selection and semantic syntax roles. Selected metadata must remain
readable in both looks. Format source paths as selectable, wrapping detail when they exceed a row;
preserve filenames as the primary label.

## Workspace and input

Keep one contextual header per plane. Frame, Dock, Close and applicable commands must remain
reachable in narrow headers; overflow uses the existing searchable menu. Avoid duplicate floating
controls over file content. The workspace title bar and plane controls use their existing
configurable visibility preferences.

Keep file input separate from spatial navigation. A clicked plane owns its content's wheel and
keyboard input; Escape or the background releases it. Docked content scrolls immediately. File
selection, model gestures and text selection must not drag or rotate the plane. Title dragging
remains the movement affordance.

Linked children originate at their source row/tile; reveal a virtualized source before measuring it.
Keep parent/child navigation intelligible through Related planes and source markers. Closing a child
returns to the parent. Tiling changes logical geometry and camera framing together rather than
shrinking controls into unusable surfaces. Keep plane backs and native engine controls consistent
with the current product preferences.

## Browsing and commands

Keep file rows dense and selectable in List, Grid, Columns, Gallery and Map. Distinguish the active
column route from operation selection. Preserve cursor, range selection and type-ahead across
rendering/culling. Blank space clears selection; its context menu targets the folder.

Commands bind to a captured target and show applicability, active result and a useful empty state.
The palette has a stable search position, bounded scrolling and keyboard navigation. Use concise
names, omit tooltips that repeat visible menu labels, and keep recent-history clearing discoverable.

Preserve the established keyboard feedback: selected/active fills and input carets, without adding
focus halos. Dialog and Settings controls use visible surface/text feedback for keyboard focus;
dialog icon buttons use the selected fill. Icon buttons need accessible action labels. Use normal
document flow for warnings and recovery; they must not cover toolbars, lists or dialog actions.
Modeless Settings keeps stable dimensions across sections and flushes changes on close.

Respect the system-following and always-visible scrollbar choices. Reserve stable scrollbar space in
long lists.

**The Essential Header Rule.** A plane header starts Essential: navigation, View, search, Frame,
Dock, pinned tools, **…** and ×, and a format's main tools only, such as a PDF's pages, zoom and
search. Layout, What can I do here? and a format's rarer tools are rows of **…**. Full shows every
control, one choice away in Settings. A hidden button never hides its command.

**The Header Spill Rule.** Measure a narrow plane header, never hide its items by breakpoint. The
header takes its plane's width and never widens the plane. Items give way strictly in rank order
into the plane's **…** menu, where they lead as their commands; a read-only detail such as a size
just gives way. The title keeps 96 px; Frame, Dock, **…** and × stay. A format control with no
command never gives way: the format's toolbar scrolls only as the last resort, with a fading edge
and a compact scrollbar. A format control the person also pinned shows once, as the pin.

## Preview controls

Place format tools with their content. PDF page controls, worksheet tabs, model Shading and
structured-tree controls stay usable in a narrow inspector. Keep Office Layout versus Reading/Sheet
explicit. Worksheet keyboard navigation keeps focus during loading, and the searchable menu uses the
same sheet selection.

**The Search Coverage Rule.** Keep search scope, progress, exclusions, partial coverage and missing
document text access in one disclosure. Bound expanded details so empty-result text and search
controls remain visible in short views.

**The Worksheet Navigation Rule.** Give virtual worksheets one keyboard stop, direct source cell
addressing and explicit saved formula details. Keyboard sheet changes and page loading retain grid
focus.

**The Worksheet Range Rule.** Keep the virtualized source grid dominant. Use the shared selection
fill for the range and a thin accent outline for the active cell while the grid has focus. Keep the
source range, Copy and saved-value detail together in the existing wrapping detail row; show copy
progress, cancellation and errors beside that work.

**The Book Reading Rule.** Use authorized local illustrations and safe internal chapter and footnote
links. Keep book search bounded and cancellable, label partial search, highlight the selected
passage and preserve chapter and scroll position for Back after a link or result jump.

**The Book Bookmark Rule.** Manage named positions in the existing reader sidebar with ordinary
labeled fields and Add, Rename and Remove actions. Let names wrap, keep the reading content beside
the sidebar at narrow desktop widths, and show unavailable chapters as disabled bookmarks with an
explanation.

Show source imagery in creative tools. Tie export, progress, optimization savings and output links
to real jobs. Label camera previews, RAW renditions and video compatibility copies accurately.
Failed renders retain retry and alternative-open actions. A stale retained preview identifies its
last loaded version.

Keep missing-file recovery reachable and retain unsaved editor text. Locating a different file opens
it separately when the original draft is dirty. Project recovery keeps open workspace content
available and offers Close project for a missing definition.

## Forms, review and outcomes

Use persistent labels, clear action verbs, inline validation and reachable footers. A malformed
branch name must explain the problem instead of silently disabling creation. Keep the checkout,
branch/base and destination visible together.

Optimize follows Prepare candidates → Review/select → Save smaller copies. Keep the optional target
size per file beside the preset; quality/dimensions and saved recipes use disclosures. Show relative
paths when preserving folders. Recipes remember settings and folder layout; file locations belong to
the current batch.

Keep each prepared candidate selectable, with Review and Retry beside it and Open beside a saved
result. Mark missed targets explicitly and leave them initially unselected. Use decimal kB/MB for
targets, original/candidate sizes, comparison captions and savings, retaining enough precision to
distinguish a near-boundary miss.

Before/after review keeps Original and Optimized together. PDF panes share page controls; images
share fit/actual-size mode and synchronized pan. Keep the Optimize header and footer fixed while the
work area scrolls. Paginate large batches and let narrow result tables scroll horizontally so action
names stay whole. Comparison controls and Save remain reachable at the shipped minimum window width
(780px).

File proposals expose exact scope, per-row inclusion, evidence and conflicts before Apply. Removal
review names every selected path and folder contents; Reject/Cancel and the affirmative action
remain reachable while long scope scrolls. Cancel receives initial focus in private-note Trash
review. Agent removal cannot inherit a hidden manual preference or saved execution grant.

Trash is a scoped folder-style dialog: one root title, Back/breadcrumbs only inside folders,
sortable accessible headers and virtual selection. Keep its count, centered Empty Trash action and
right-aligned Refresh/Done reachable. Known origins are selectable detail; unknown origin/date stays
explicit. Date added is not a substitute for deletion time. Distinguish Full Disk Access recovery
from a native folder-access grant.

Show actual process outcomes, literal commands and explicit copy/export recovery. Label external
agent status Reported with its timestamp and sequence. File/diff links describe current source,
rather than implying a preserved historical patch. Task restoration retains tools without replaying
commands or inferring completion.

## Visual restraint

Keep the shared token system and authored icon family. Use real file content for preview imagery and
dedicated public-safe sample work for documentation. Dense tables need hierarchy and alignment, not
decorative cards or extra labels.

**The Token Scale Rule.** Size app type with the five type steps only: label (never under 11 px),
compact, body, section and title, each following the interface density. Space with the six gap
steps. A panel, a popover or a floating bar takes the panel shadow; dialogs, the palette and menus
keep the overlay shadow. Rendered documents keep their own sizes. `tests/design-tokens.test.ts`
checks the stylesheet's scales against this file's tokens and holds each stylesheet's off-scale
spacing to a budget that only goes down.

**The One Meaning Rule.** An icon means one thing everywhere. Frame frames a plane, Fit fits its
content and Layout arranges planes, each with its own glyph; zoom, new folder, edit, stop and pin
have theirs. Two controls in one header never share an icon.

Retain the existing product choices: no persistent wordmark/tagline in the app, plane tab bar,
global arrangement toolbar, theme button, shortcut footer or operations rail. Settings and
contextual commands own those controls. Keep foreground profiling separate from routine hidden
functional verification.

Settings rows keep a shared control edge, including shortcut recorders. Color swatches have fixed
square bounds. Permission checkboxes keep their own width and sit beside their text. Models lists
show the full saved model ID, an honest connection status and the effective default before setup
details; opening Settings must not connect to a provider.

## Components

### Shared controls

Build from the shared controls before styling a one-off. Each keeps the class its caller gives it,
so a feature still sets its own spacing.

**The One Disclosure Rule.** Every disclosure is native and has the one summary look: a 12 px
chevron that turns as it opens and no browser marker; a summary with its own icon keeps it. Use the
row form for a list of expandable items, such as recipes, with a count or state at the far end and
the settings row's height; the compact form for a secondary part of a form or dialog, where only its
words take the click; the inline form for a few words inside a status line, such as search coverage.
Disclosures that compete for room in a dialog form a group: opening one closes the others, and
Escape closes the open one before the dialog.

**The Toggle Text Rule.** A click on a summary, a checkbox or radio label, a tab, a menu item or an
option acts; it never starts a text selection. Paths, values and messages stay selectable.

**The Whole Path Rule.** Show a read-only path as a path field: one click selects all of it, and the
copy button beside it copies it as text, then says Copied for a moment, announced politely, or Not
copied with the reason. A path wraps under its name, or keeps to one line where room is short and
shows all of it on hover. Paths copy through the desktop pasteboard, other text through the
clipboard.

**The Button Kinds Rule.** A context has at most one primary action, in the accent fill. A visible
text button is secondary: an outline on the field fill. A bare button is the quiet ghost, filled
only under the pointer, as icon buttons are. An action that removes or discards uses the danger ink.
Never re-add a border to one button to make it look secondary.

**The Shared Edge Rule.** A setting-like row in a dialog or panel is the Settings row: a sentence
label, an optional muted detail line, and the control at the shared 180 px edge. Below 540 px of its
container the control goes under the label.

**The Held Panel Rule.** A panel beside the work has a title bar, a body that scrolls and an
optional footer, with sections headed inside the body. It never places itself and never takes a
fixed position: the space's overlay grid or a plane holds it and sets its width, so the same panel
works inside a transformed or pinned plane, and its rows follow the panel's width, not the window's.
Panels in the overlay grid share it and never cover each other. A collapsible panel collapses from
its title to the title bar and a short status.

**The Anchored Layer Rule.** A popover or menu opens from its button or the pointer, placed from the
anchor's box on screen, so it lines up with a control in a transformed plane. It stays 8 px inside
the window, opens above the anchor when there is no room below, and closes on an outside press or
Escape, returning focus to what opened it.

### Contextual discovery and pinned tools

What can I do here? uses the shared dialog and ordinary action rows. Show the context name first,
then the captured path on one line: one click selects all of it, its copy button copies it and
hovering shows it whole. Keep search and Done stationary around the scrolling action list. With
optional sections closed, the minimum window (760 × 540px) shows two complete action rows even with
eight saved pins.

**The Discovery Space Rule.** Pinned tools and keyboard help start closed. Opening either closes the
other; each expanded section has bounded scrolling while search and the footer stay reachable.
Escape closes an open disclosure before dismissing the dialog.

Keep the pin count in the collapsed summary. At 8 of 8, explain that a tool must be unpinned before
another can be added. Empty results offer Clear search or Show all actions when applicable.

**The Captured Action Rule.** Discovery, pinned tools, menus and shortcuts retain the captured
target. Show why an action is unavailable, and preserve missing saved action IDs for repair or
explicit unpinning without substituting another action.

### First run

A first run is quiet: the space toolbar and viewcube start off, the grid on, and the minimap appears
once the space holds three planes.

**The First-Run Tips Rule.** A new profile shows one card above its first folder, in the folder's
own flow before any insight cards: Space previews the selected file, the palette's keys find any
action, and a plane's title drags it. The card names the keys the person has, leaves out dragging
while titles do not move planes, and drops each step once it is used. With Space and the palette
both used, or the card dismissed, it retires for good. A profile made before it never shows it. It
never floats over content and never becomes a shortcut footer.

### Backup review

**The Backup Summary Rule.** Use singular or plural workspace labels and scaled file-size units
beside the creation date. Keep workspace names, document counts and inclusion notices readable in
the existing dialog, with Cancel and the save or restore action reachable around scrolling content.

### Speech and dictation

**The Speech Setup Rule.** Reuse compact Settings controls. Separate local model rows with the
shared line role; show each model's name, MiB size, installation/selection state, description and
applicable actions. Language and Microphone use shared searchable choice controls and stack below
their labels at narrow widths. Keep a missing saved microphone visible as unavailable rather than
silently selecting another device.

**The Hosted Speech Access Rule.** Keep the saved provider, full model ID and wrapping endpoint
visible with ordinary setup actions. Use shared searchable choices and labeled fields; mask
credentials. Give Audio access its own status and explicit allow/revoke action for the saved
endpoint and model, separate from microphone and chat permissions. Keep setup and access actions
reachable through scrolling.

**The Hosted Speech Check Rule.** Run Check connection and model only on request. Keep its status
and key/model recovery in the ordinary Settings flow. Distinguish metadata-only catalog availability
from Audio access, transcription quality and remaining credit. The check records and sends no audio.

**The Dictation State Rule.** Name the captured destination first in the shared Dictate dialog.
Distinguish preparing, listening, local transcription, hosted transcription, editable review and
failure. Name the hosted provider, endpoint and model with the audio-transfer disclosure. Keep
microphone level and elapsed time with capture status, errors and settings recovery in normal flow,
and Cancel plus the current action reachable around scrolling content.

**The Transcript Field Rule.** Treat the transcript as ordinary interface text: inherit the app
font, field, ink, line, control radius and accent caret roles. Focus the editable transcript for
review and keep its vertical resizing and scrolling within the dialog.

**The Captured Dictation Rule.** Cancel capture when the destination identity changes or becomes
unavailable. Require an explicit insertion action after transcript review; inserting text does not
send a message or run a command.

### Task creation review

**The Task Parameter Form Rule.** Treat suggested task parameters as ordinary editable fields for
task name, repository, workspace, branch mode, optional local base and new worktree folder. Align
full-width fields and the workspace choice within the task dialog; bound its height to the viewport
and scroll fields while the header and footer stay reachable. Show validation inline. Yield the
modal for native confirmation, preserve cancelled parameters and offer retained-worktree recovery
after partial failure instead of blind retry.

**The Task Creation Review Rule.** Keep repository, worktree destination, workspace name/identity,
branch mode and pinned revision readable in wrapping detail. Use Create task for the affirmative
action in both shared and native review. Keep Reject/Cancel and the affirmative action reachable
around scrolling scope. Keep the terminal stopped and show Load Git changes before Git review.

## Maintaining this document

Record durable interface rules here. Put feature instructions in [user guides](docs/README.md),
ownership in [CONTEXT.md](CONTEXT.md), proposals in [research](docs/research/README.md), and
run-specific evidence in retained generated reports. A source inspection or mocked fixture does not
qualify physical accessibility, another operating system, distribution signing or Store behavior.
