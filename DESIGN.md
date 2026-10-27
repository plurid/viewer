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
long lists and keep overflowing plane tools horizontally scrollable, with compact scrollbars that
preserve room for the surrounding header controls.

## Preview controls

Place format tools with their content. PDF page controls, worksheet tabs, model Shading and
structured-tree controls stay usable in a narrow inspector. Keep Office Layout versus Reading/Sheet
explicit. Worksheet keyboard navigation keeps focus during loading, and the searchable menu uses the
same sheet selection.

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

Retain the existing product choices: no persistent wordmark/tagline in the app, plane tab bar,
global arrangement toolbar, theme button, shortcut footer or operations rail. Settings and
contextual commands own those controls. Keep foreground profiling separate from routine hidden
functional verification.

Settings rows keep a shared control edge, including shortcut recorders. Color swatches have fixed
square bounds. Permission checkboxes keep their own width and sit beside their text. Models lists
show the full saved model ID, an honest connection status and the effective default before setup
details; opening Settings must not connect to a provider.

## Components

### Contextual discovery and pinned tools

What can I do here? uses the shared dialog and ordinary action rows. Show the context name first;
keep the full captured path selectable in a secondary disclosure. Keep search and Done stationary
around the scrolling action list. With optional sections closed, the minimum window (760 × 540px)
shows two complete action rows even with eight saved pins.

**The Discovery Space Rule.** Pinned tools and keyboard help start closed. Opening either closes the
other; each expanded section has bounded scrolling while search and the footer stay reachable.
Escape closes an open disclosure before dismissing the dialog.

Keep the pin count in the collapsed summary. At 8/8, explain that a tool must be unpinned before
another can be added. Empty results offer Clear search or Show all actions when applicable.

**The Captured Action Rule.** Discovery, pinned tools, menus and shortcuts retain the captured
target. Show why an action is unavailable, and preserve missing saved action IDs for repair or
explicit unpinning without substituting another action.

### Backup review

**The Backup Summary Rule.** Use singular or plural workspace labels and scaled file-size units
beside the creation date. Keep workspace names, document counts and inclusion notices readable in
the existing dialog, with Cancel and the save or restore action reachable around scrolling content.

## Maintaining this document

Record durable interface rules here. Put feature instructions in [user guides](docs/README.md),
ownership in [CONTEXT.md](CONTEXT.md), proposals in [research](docs/research/README.md), and
run-specific evidence in retained generated reports. A source inspection or mocked fixture does not
qualify physical accessibility, another operating system, distribution signing or Store behavior.
