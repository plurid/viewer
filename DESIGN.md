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
  file-picker:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.dialog}'
    width: '780px'
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
Keep parent/child navigation intelligible through Related planes and source markers; a child whose
only relative is its parent shows Back to parent plane alone, not both. Closing a child returns to
the parent. Tiling changes logical geometry and camera framing together rather than shrinking
controls into unusable surfaces. Keep plane backs and native engine controls consistent with the
current product preferences.

## Browsing and commands

Keep file rows dense and selectable in List, Grid, Columns, Gallery and Map. Distinguish the active
column route from operation selection. Preserve cursor, range selection and type-ahead across
rendering/culling. Blank space clears selection; its context menu targets the folder. Quick Preview
follows its plane's selection: with several selected, Left and Right step through them; otherwise
every arrow moves the selection as the plane's own view would, from the file shown, unless a focused
preview scrolls or moves with it. Once the plane has closed, the arrows step through what Quick
Preview shows.

Commands bind to a captured target and show applicability, active result and a useful empty state.
The palette has a stable search position, bounded scrolling and keyboard navigation. Use concise
names, omit tooltips that repeat visible menu labels, and keep recent-history clearing discoverable.

Preserve the established keyboard feedback: selected/active fills and input carets, without adding
focus halos. Dialog and Settings controls use visible surface/text feedback for keyboard focus;
dialog icon buttons use the selected fill. Icon buttons need accessible action labels. Use normal
document flow for warnings and recovery; they must not cover toolbars, lists or dialog actions.
Modeless Settings keeps stable dimensions across sections and flushes changes on close.

Respect the system-following and always-visible scrollbar choices. Reserve stable scrollbar space
only where a list's rows must align with its column headers. Headerless lists use the full width
until their content scrolls.

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

**The Preview Bar Rule.** Keep preview toolbars one fixed-height line, in a plane header or where
the preview stands. Measure controls with the shared header overflow rules: collapse labeled actions
to named, tooltipped icons before spilling lower-priority actions into **…**, the shared button
menu, but never for an item that would give way anyway. Controls that act as one, such as zoom and
its level, give way together. A change of state never adds or removes a toolbar control: one that
waits keeps the keyboard and says why, to a pointer, the keyboard and VoiceOver, and the rarest
gives way first. A table's or view's own toolbar under its format's is measured the same way where
it stands. File facts belong in the footer. Controls without commands may scroll horizontally as a
last resort. A pinned plane's format tools stand in its content, where it floats.

**The Preview Identity Rule.** Keep the footer one fixed-height line. Truncate the filename in the
middle and retain its extension; it keeps 96 px before details give way. Dimensions give way before
kind, then size; the complete filename and details remain in its tooltip and accessible name. Where
a dialog's title names the file, the footer shows only the details. Selecting a file never resizes
the frame or scrolls its column strip. List columns retain their widths; the resizable preview fills
the rest, at least the width its plane keeps for it in every folder.

**The Picture Turn Rule.** Rotate left and Rotate right turn a picture's view, never its file, and
the view remembers the turn, fitted from its first frame. Their keys, ⌘L and ⌘R in Settings →
Shortcuts, act on the picture that has the keyboard: its plane with its own header, never a pinned
plane's header left in the space, or the dialog or column that holds it. A trackpad turn acts on the
picture under the pointer, else on that one, and settles on a quarter once the fingers have been
still a moment. Save Rotated Copy keeps a turn as a new file beside it, made as the Rotated Copy
quick actions make one, about the picture's size and looking as it did.

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

**The Robot Check Rule.** Keep robot checks outside the generated canvas in a compact disclosure
that starts closed. Show Checking…, Passed, Needs review or Check again in its summary, with errors
and stale reasons in the report. Bound and scroll the report; let actions and details wrap at narrow
desktop widths. Show target positions, measured error, tolerance and units together. Link hard joint
limit violations to their source definitions. Keep Check poses and Save check JSON… in the Viewer
report; enable export only for a current check. State that checks cover endpoint positions and hard
joint limits only. Keep Compare base placements in a separate disclosure that starts closed. Show
original and alternative bases with measured target errors, keeping the model, world targets, tool
point and tolerance fixed. Invalidate the comparison when either canvas changes. Keep Save
comparison JSON… in the native Viewer report and enable it only for current, comparable checks.
Never present visual replay as trajectory verification.

Canvas details share a compact row above the workbench. Open one inspector at a time, bound its
height and scroll its contents so the canvas stays visible. Inset summaries and file rows from the
plane edges. Align asset source actions, allow long names to wrap and keep keyboard focus on the
summary when Escape closes its section.

**The Canvas Action Status Rule.** Keep the actor, action and current outcome together in a compact,
wrapping row above the canvas. Keep Take over reachable while an action runs. Action completion
describes execution; checked robot results remain in Viewer's independent report.

**The Canvas Drawing Review Rule.** Put cutting geometry beside measured width, height, outline and
hole counts, and hole diameters. Keep millimetre units visible and mark approximate diameters. Use
the shared field and ink roles. Bound the preview height and scroll measurements so the canvas,
Cancel and Save drawing… remain reachable.

**The Local Station Presentation Rule.** Limit the station presentation patch to imported local
copies of actual Meta output and retain the provider HTML unchanged. Preserve flat controls, system
type, neutral robot and bench, and restrained blue accents. Keep scene labels legible and distinct
in screen space, Fictional station quiet and Mounting point visibly labeled. Expose status changes
through polite live regions. Describe the saved evaluation and selection accurately on reopen. Keep
human-readable task labels and measurement units visible, with raw evaluation and check output
available in disclosures that start closed. Preserve evaluation and action code, saved inputs and
measured outcomes. The canvas host does not apply these edits to other generated canvases.

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

**The Output Form Rule.** Export forms, command parameters and project folder choices put labels
above their fields, with the small gap below each label and the content gap between fields. Fields
fill the available row; numbers, colors and toggles keep compact controls. Checkbox text stays
beside its checkbox. File names use an editable stem and a fixed format suffix, keeping the suffix
visible and opening long stems at their end. Folder choices lead with the folder's own name, then
its path label, beside Choose…. Full names and paths remain available in tooltips and accessible
names, which start with the visible label. Validation and name-conflict outcomes stay below the
field, name the item that is there and say what export does. A name loses trailing spaces and typed
copies of its suffix (`.jpeg` for `.jpg` too) when the field is left; a leading space stays, since
it sorts a name first. A name that starts with a dot is allowed with a warning that the file will be
hidden; control characters and names past 255 characters with their series number are refused. Put
source dimensions beside size controls and show the selected export's dimensions and format there;
explain a skipped enlargement only when it applies. Help text states facts the person needs at that
field; it never describes how Viewer works inside.

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

**The Own Keys Rule.** Settings saves only the keys the person changed; a key as shipped always
comes from the keymap, so a key shipped differently reaches everyone who never changed it. A key
answers one binding: a shipped key the person gave to something else is left to theirs, and the
command's row says so. A key shared on purpose, as ⌘L by Go to Folder… and Rotate Picture Left, says
so in both rows.

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

**The Path Label Rule.** Every shown path is a path label: home reads `~`, and on one line the names
after `~` or the root give way from the start, so the item's own name stays (`~/…/Job 1042/3D`); a
name too long by itself loses its middle and keeps a short extension (`.pdf`, never `.0 notes`), and
a label is never wider than its row. A label stretches across its row, never sized to its own text.
A server location starts at its server (`al@build:~/Jobs`) and copies as a person types it, or as
the location itself until its connection is known. Copies of one file read from the folder they
share, starting at the folder that tells them apart (`Job 1042/…/part.dxf`), when that folder is
home, inside home, or elsewhere and neither a root nor a folder that holds home; otherwise they read
from `~` and the root, with no shared-folder heading. The tooltip and the accessible name hold the
whole path, and copying, by button or by ⌘C, copies the whole path once. A label refits when its
row, the interface font, the density or the theme changes. A message that names a path writes home
as `~`, quoted paths too; a command line a person may run keeps its paths whole.

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

**The Overview Rule.** Overview stays reachable from the palette when the space is shown and holds a
plane, including when the minimap is hidden. Opening and closing it never changes the saved minimap
visibility settings. Minimap corner defaults to Automatic, which avoids controls; a fixed corner
keeps the minimap and Overview in that corner even over controls, falling back only when the
viewport is too small. An expanded fixed Overview follows viewport and layout changes. The viewcube
moves clear of a fixed map while keeping its engine conceal behavior. Light dismissal keeps focus on
a control the person clicked; Escape returns it to the connected opener.

**The Anchored Layer Rule.** A popover or menu opens from its button or the pointer, placed from the
anchor's box on screen, so it lines up with a control in a transformed plane. It stays 8 px inside
the window and never covers its anchor: below it when it fits, else above, held by its bottom, else
on the side with more room, its list shortened to scroll. Only when neither side has room for three
rows, under its search field if it has one, does it cover the anchor's edge. It moves with its
anchor while a plane settles after Frame, Dock or a new plane. A second press on the anchor or its
label closes it, as do an outside press and Escape, returning focus to what opened it. A press
outside a button's menu only closes it: the control it lands on does not act, and a right press
shows no context menu. It also closes when the window loses focus or resizes, when what holds its
anchor scrolls, and when the person turns the wheel or pinches outside it. A choice list of 8 or
fewer has no search field and moves by type-ahead, as a native menu; a longer one keeps its search
field, which shows "Search", and opens on its current choice.

### Ordinary window dialogs

**The Window Dialog Rule.** Ordinary file choices and notices use the shared dialog in the
requesting Viewer window. Size notices to their copy, scroll long details and keep actions visible.
Show a message once when it matches the title. In these dialogs, keyboard focus retains the primary
action's accent fill and a destructive action's danger ink.

**The File Choice Rule.** Keep folder navigation and the editable path above the browser, with
Locations, Favorites and Recent beside the filtered file list. Use bounded scrolling for places,
files and destination fields while the footer stays stationary. Keep File name, file type, new
folder entry and conflict recovery within the chooser. Retain the order of multiple selections in
the result. Keep System dialog… visible beside the chooser actions for an explicit OS fallback.

The file chooser fits inside the viewport and narrows its places column when space is limited.
Protected approval and platform access prompts retain the native boundaries described in the
[window-dialog decision](docs/adr/0012-window-owned-dialogs.md).

### Contextual discovery and pinned tools

What can I do here? uses the shared dialog and ordinary action rows. Show the context name first,
then the captured path on one line: one click selects all of it, its copy button copies it and
hovering shows it whole. Keep search and Done stationary around the scrolling action list. With
optional sections closed, the minimum window (760 × 540px) shows two complete action rows even with
eight saved pins.

**The Defined Workspaces Rule.** Open rows lead within the same search band and are never hidden.
Definitions are searched by name, not listed as hundreds of open workspaces. A first run stays
quiet: do not create a definition file or ask for source access until the person requests it.

**The Found Workspaces Rule.** Find silently from folders the person uses. Show found workspaces
only in search, Manage, Recently closed after planes are remembered, the workspace offer, and an
empty Change workspace… that lists fewer than eight recent definitions, where up to three never
opened fill it. Mark them Found and show their root as a path label. Explicit definitions win for
the same root. Not a Workspace hides one at once and offers Undo for eight seconds in the place of
the list's count, on either tab, with Forget Planes… when it remembers planes; only the notice's
words are announced. Settings counts found and hidden ones, names the count on the button that shows
them again, and offers Undo for eight seconds.

**The Workspace Offer Rule.** Offer the workspace a folder belongs to, the innermost one search
lists, as one insight card in the folder's flow, after the first-run tips, in the first files plane
that root holds as its own, within the three cards. Offer it only when opening adds something:
remembered planes, a definition that opens more than a folder at its root, or the workspace already
open elsewhere. Name the workspace and what it adds, show its root, and act with the row Change
workspace… lists; the action's accessible name names the workspace. Never offer it to the workspace
linked to it or mostly inside its root, inner roots included. Dismissal hides it for that root and
stays private, outside configuration; the empty palette's Suggested lists it with the same reason
until then, three rows in all.

**The Definition Command Rule.** Every open, reopen, reset, launch restore and reload asks in each
command plane: show the literal command and folder, primary **Run `npm run dev`**, secondary **Shell
only**. Run has no autofocus. A normal-flow notice offers secondary **Run all N commands** and **Not
now**. Nothing starts on open. A new or changed command also needs a native review of its folder and
exact profile program. Disabled Run controls show their reason; Shell only stays available in
agent-driven views. Keep each xterm attached from the Run choice, even offscreen.

**The Declared Command Rule.** Show a folder's declared command as a literal line under its file
name, with its body as muted detail. A pick fills and focuses the input; it never runs the line.
Keep Run the one primary action. Discovery never executes a tool, asks for access or serves an
agent-driven window. Slow reads leave typing available without an error notice.

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

**The License Reminder Rule.** A configured direct build's 30-day trial is silent in the workspace;
only About and Settings show days left. After it ends, keep every feature working and show a calm
bar in normal flow with Buy Viewer, Enter license… and Hide. Hide lasts until the next launch,
across windows and reloads. Never use a modal or delay. Store, unconfigured, headless, terminal CLI
and MCP runs show none of this. License Key… names the menu and palette action; License names the
Settings page, distinct from third-party notices.

**The First-Run Tips Rule.** A new profile shows one card above its first folder, in the folder's
own flow before any insight cards: Space previews the selected file, the palette's keys find any
action, and a plane's title drags it. The card names the keys the person has, leaves out dragging
while titles do not move planes, and drops each step once it is used. With Space and the palette
both used, it teaches Frame all planes once the workspace holds multiple planes, using the
configured shortcut. It retires after all steps or dismissal. A previously retired profile stays
retired. It never floats over content and never becomes a shortcut footer.

### Backup review

**The Backup Summary Rule.** Use singular or plural workspace labels and scaled file-size units
beside the creation date. Keep workspace names, document counts and inclusion notices readable in
the existing dialog, with Cancel and the save or restore action reachable around scrolling content.

### Speech and dictation

**The Speech Setup Rule.** Reuse compact Settings controls. Separate local model rows with the
shared line role; show each model's name, MiB size, installation/selection state, description and
applicable actions. Language and Microphone use the shared choice control, searchable above 8
choices, and stack below their labels at narrow widths. Keep a missing saved microphone visible as
unavailable rather than silently selecting another device.

**The Hosted Speech Access Rule.** Keep the saved provider, full model ID and wrapping endpoint
visible with ordinary setup actions. Use the shared choice control and labeled fields; mask
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
modal for native confirmation, preserve canceled parameters and offer retained-worktree recovery
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
