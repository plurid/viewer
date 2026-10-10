---
name: Viewer
description: The current Plurid application system for dense file browsing and linked spatial previews.
colors:
  space: "#272a30"
  surface: "#31353d"
  raised: "#393e47"
  ink: "#f2f4f6"
  muted: "#b1bac6"
  subtle: "#9fabb9"
  accent: "#82b3cf"
  line: "#454b55"
  selection: "#3a5368"
  selection-muted: "#c4d7e3"
  danger: "#ff9da0"
  field: "#292d34"
  light-space: "#eef0f4"
  light-surface: "#ffffff"
  light-raised: "#f4f6f8"
  light-ink: "#202733"
  light-muted: "#546071"
  light-subtle: "#637084"
  light-accent: "#337396"
  light-line: "#d5dbe2"
  light-selection: "#dcebf4"
  light-selection-muted: "#546071"
  light-danger: "#a62f3e"
  light-field: "#f4f6f8"
  file-image: "#b7ba93"
  file-code: "#b4aecf"
  light-file-image: "#686d32"
  light-file-code: "#6c5d9c"
  syntax-string: "#b7c79e"
  syntax-keyword: "#c9b4d6"
  syntax-number: "#dfb891"
  light-syntax-string: "#386731"
  light-syntax-keyword: "#755183"
  light-syntax-number: "#805d32"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  body-compact:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
  section-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "22px"
rounded:
  badge: "4px"
  control: "5px"
  tile: "6px"
  menu: "8px"
  dialog: "10px"
spacing:
  tight: "4px"
  small: "6px"
  inline: "8px"
  content: "12px"
  panel: "16px"
  dialog: "18px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.space}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  button-ghost-hover:
    backgroundColor: "{colors.raised}"
  button-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink}"
  icon-button:
    rounded: "{rounded.control}"
    padding: "5px"
    size: "30px"
  input-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  location:
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  location-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink}"
  plane-tab:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  plane-tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  count-badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.space}"
    rounded: "{rounded.badge}"
  file-row:
    typography: "{typography.body-compact}"
    textColor: "{colors.ink}"
    padding: "0 18px"
    height: "36px"
  file-row-selected:
    backgroundColor: "{colors.selection}"
  plane-titlebar:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "0 9px 0 14px"
    height: "40px"
  context-menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.menu}"
    padding: "5px"
    width: "228px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    width: "440px"
---

# Design System: Viewer

## Overview

**Creative North Star: "Current Plurid application family"**

Viewer inherits the user-confirmed Plurid world: graphite surfaces, system typography, dense native file rows, and one coordinated look for the application shell and spatial engine. Familiar desktop controls remain legible while the workspace shows folders and their linked previews together.

The defining visual behavior is a titled file plane beside its folder, with a visible relationship and a focused docked view available from the same chrome. File contents supply the imagery and dimensional detail; the interface uses restrained surfaces and authored SVG icons.

**Key Characteristics:**

- Coordinated dark and light shell and engine looks.
- Dense rows, quiet metadata, and explicit selection and keyboard focus.
- Linked spatial planes with familiar titlebar controls and focused docking.
- File-content previews within the same visual system.

Extracted from [renderer styles](packages/viewer-electron/app/src/renderer/styles.css), [engine looks](packages/viewer-electron/app/src/renderer/workspace/look.ts), [UI primitives](packages/viewer-electron/app/src/renderer/ui/primitives.tsx), [file views](packages/viewer-electron/app/src/renderer/explorer/views.tsx), and [workspace chrome](packages/viewer-electron/app/src/renderer/workspace/WorkspaceSurface.tsx). [PRODUCT.md](PRODUCT.md) confirms the incumbent family and desktop constraints.

## Colors

The palette uses graphite neutrals in dark mode and pale neutral space with white content surfaces in light mode. Frontmatter names without a `light-` prefix describe the default dark look; prefixed names are the corresponding light values. Switching the look replaces the source CSS variables and sends the same space, surface, ink, and accent values to the engine.

### Primary

- **Muted blue accent:** `accent` and `light-accent` mark folder/model icons, active navigation icons, focus, links, progress, and the primary action. They do not replace the neutral content surface.
- **Blue selection:** `selection` and `light-selection` identify selected controls and files. Selected file metadata uses the corresponding `selection-muted` value.

### Neutral

- **Workspace:** `space` sits behind planes; `surface` carries folder and preview contents, dialogs, menus, and operation panels.
- **Raised and field surfaces:** `raised` separates titlebars and hover states; `field` separates inputs, file headers, and content stages.
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
- **Body:** The `body` role serves controls and application text; `body-compact` serves file names and supporting preview text.
- **Label:** The `label` role serves file metadata, column headers, status bars, and preview metadata.
- **Code:** The `code` role serves source listings. JSON retains its observed taller line spacing (24px); CSV uses its content-specific monospace row treatment (11px/32px).

Use tabular numerals for file sizes and operation counts. File and plane names truncate to one line; error text and document content can wrap. Markdown headings belong to the displayed document and retain their content hierarchy.

**The Content Hierarchy Rule.** Keep document headings and syntax styling inside previews; extend application chrome with its compact title, body, and label roles.

## Layout

The shell fills the native window. A titlebar (56px) reserves the left inset for macOS window controls, a location rail (210px) sits beside the workspace, and plane tabs occupy a header (46px). The workspace footer is compact (30px). Shell and plane contents use independent overflow regions so long file lists do not move their chrome.

At the compact breakpoint (1050px), the rail narrows (180px), the operations panel overlays the right side, and secondary footer copy hides. The native window has an implemented minimum (780×560). This is a desktop application system; no phone navigation pattern is established.

Automatic planes follow the measured workspace: width is bounded from 380px to 960px with 32px of horizontal clearance; height is bounded from 300px to 660px with 72px of vertical clearance. Manual resizing remains available. Framing waits for the engine's viewport measurement before fitting the visible relationship.

File lists use virtualized rows (36px), with a flexible name column and fixed metadata columns. Grid and gallery use contained thumbnails and truncated file names; columns retain separate scrollable folder lists. Small control gaps and the repeated frontmatter spacing steps keep chrome compact. Dialog content uses the larger panel/dialog steps.

**The Reachable Chrome Rule.** Keep plane titlebars and relationships within the framed viewport, and keep frame/dock commands in the workspace header where they stay clear of preview actions.

## Elevation & Depth

Depth comes from the spatial engine, layered neutral surfaces, dividers, and restrained ambient shadows. Rows and ordinary controls stay flat. Menus, dialogs, notices, and the compact operations overlay share the source overlay shadow; PDF sheets have a separate small page shadow.

### Shadow Vocabulary

- **Dark overlay:** `box-shadow: 0 18px 56px #0005` for transient surfaces in the default look.
- **Light overlay:** `box-shadow: 0 18px 56px #20304025` for the corresponding light surfaces.
- **PDF sheet:** `box-shadow: 0 2px 12px #0003` for the rendered white page within its content stage.

Engine camera transitions support framing and docking. Media and model activity is bounded by visibility; a model can orbit independently of its plane. CSS honors reduced motion, including the loading indicator.

**The Task Depth Rule.** Use elevation for spatial relationships and transient controls; preserve flat file rows for scanning.

## Shapes

Controls have modest rounding, grid tiles slightly larger rounding, and menus/dialogs progressively softer corners, using the recorded radius roles. File rows, column separators, and preview toolbars remain straight edged. Thin borders separate shell regions, inputs, and overlays. Small circular dots serve status and the existing wordmark detail.

Icons are authored outline SVGs on a 24×24 viewBox with a consistent stroke (1.6), rounded caps and joins, and inherited color. Normal interface icons are usually 18px; file aliases use the same SVG system as a small overlay (11px). Retain the existing native application icon; preview imagery comes from the user's files.

## Components

### Buttons

Compact text and icon controls share the control radius. Ghost controls gain the raised surface on hover and selection on press; selected controls keep selection with primary text. Primary controls use accent with workspace-colored text and a stronger weight (600); hover brightens their accent. Disabled controls lower opacity (0.45). Icon buttons have a square footprint (30px), an SVG, and an accessible action label.

### Chips

The implemented count badge is a compact operation-count marker using accent, workspace-colored text, the badge radius, and tabular numerals. It is informational; no general-purpose filter-chip system is established.

### Cards / Containers

Planes are the recurring content containers: neutral content surface, a raised titlebar, and bounded scrollable body. Dialogs use the dialog radius, line border, shared overlay shadow, and separated header/footer. Context menus use the smaller menu radius and compact full-width action rows. These patterns define containers without adding decorative cards around file content.

### Inputs / Fields

Fields use the field surface, line border, control radius, and subtle placeholder text. The accent caret and inset focus outline identify input focus. The current-folder filter is an inline, transparent field within its bordered search row. Name dialogs focus their input after the native modal enters the top layer, and show readable inline errors.

### Navigation

The location rail uses icon-and-label rows with ellipsis for long names. Selection changes the row surface and colors its icon with accent. Plane tabs use muted text at rest and content-surface/primary-text treatment for the active plane. Breadcrumbs scroll horizontally; the current folder has stronger text. Native titlebar controls remain independent of the draggable window region.

### File Rows

The dense row separates file identity from muted date, kind, and size metadata; file sizes align right. Hover uses the raised surface; selection changes the row and its metadata together. Alias overlays remain visible at native file-icon size. Grid and gallery carry the same file-selection treatment.

### Linked Plane Chrome

Each folder/preview plane has a title, type label, and frame, dock, and close controls. Only the title is the plane drag handle. The workspace header owns global frame/dock/navigation actions; its duplicate engine floating dock rail is disabled. Preview-specific toolbars sit below this common chrome and leave the actual file content as the main surface.

### Menus and Feedback

Context menus render through body portals with viewport-bounded overflow. Dialogs use native modal focus behavior. Keyboard focus is an accent outline (2px) inset into the control; errors use the danger role and wrap long paths. Empty/loading views use SVGs, plain task text, and the existing type hierarchy.

## Do's and Don'ts

### Do:

- Do coordinate the shell, engine, and preview look through the shared surface and text roles.
- Do preserve dense file rows and readable selected metadata across list, grid, and gallery.
- Do use authored SVG icons, accessible action labels, and visible keyboard focus.
- Do keep frame/dock controls reachable and plane dragging on the title.
- Do retain file-content conventions such as syntax coloring, contained imagery, and the Markdown quotation border.

### Don't:

- Don't introduce a separate decorative identity or display-font tier into this confirmed application family.
- Don't place duplicate floating engine controls over preview actions.
- Don't make file content or model gestures drag the plane instead of performing their own task.
- Don't reuse dark syntax colors unchanged in light previews or use ordinary muted text on dark selected files.
- Don't turn synthetic verification fixtures into shipping product imagery.
