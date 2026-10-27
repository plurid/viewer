# Desktop quality and durable workspaces

Viewer should remain useful as a person's files, habits and projects grow. Everyday browsing must be
familiar immediately; deeper tools should remain discoverable and configurable. The same work must
survive closing a view, restarting the application, updating it and moving to another computer.

This document defines the capabilities and acceptance criteria for that work. Current behavior is
documented in the guides and references; an unchecked requirement here is not a shipped capability.

## Durable personal state

Provide a portable backup of workspaces, notes, checklists, unsaved text, reading positions, media
editing decisions, saved recipes, presentation profiles and keyboard choices. Explain exactly what
the backup contains before writing it. Keep the format versioned, inspectable and independent of the
application's cache layout.

Import presents a preview, lets the person relink source folders and creates restored work beside
existing work. Missing files retain their references and recovery actions. Keep credentials, access
grants, browser sessions, generated previews and active process state outside the portable bundle.
Restoring never starts a terminal, server, command or agent. Original backups remain unchanged.

Acceptance: export generated work, import it into an isolated profile, relink its source folder,
restart and confirm the documents, positions and layout remain usable. Invalid, newer, oversized or
incomplete bundles explain the problem and leave current work intact.

## Compatibility of learned behavior

Preserve stable command identifiers and existing aliases. Retain a person's shortcuts, hidden
controls, view choices and toolbar arrangements across updates. Missing command or plugin references
remain identifiable and repairable; they must not silently select another action.

Retain original migration inputs before saving an upgraded profile. Distinguish unsupported newer
data from damaged data. Keep a compatibility fixture for each supported saved-state version and
exercise migrations repeatedly, including inherited presentation and per-workspace overrides.

Acceptance: old-profile fixtures restore their effective choices; a second save and reopen retain
them. Hidden plane navigation, selection, preview positions and customized commands remain stable.

## Complete desktop interaction

Menus, contextual commands, toolbars and keyboard shortcuts use the same action definitions and
captured target. Text entry owns text-editing keys; file views own selection and navigation keys;
spatial navigation must not intercept either. Escape dismisses the innermost interaction first.

Qualify platform text movement, selection, range selection, Tab navigation, native application
menus, Services, accessible names and window movement. Start with macOS, keeping shared behavior
portable and making platform differences explicit rather than rewriting the rendering engine.

Acceptance: browse, select, rename, search, edit and export using only the keyboard. Repeat with a
pointer and with platform accessibility tools. Focus returns to the originating control after a menu
or dialog closes. Window and plane dragging retain a predictable grab area.

## Visible controls and stable geometry

Make actions recognizable before hovering. Use existing button, selection, pressed and disabled
roles consistently. Icon-only controls have meaningful accessible names; visible labels do not
produce duplicate tooltips.

Provide system-following and always-visible scrollbar choices with usable drag targets. Reserve
space where needed so scrolling never relocates a button, clips the last column or crops a preview.
Horizontally overflowing controls must reveal that more controls exist and remain
keyboard-reachable. Respect reduced motion and keep context visible when optional chrome is hidden.

Acceptance: short and overflowing content, always-visible scrollbars, both appearances, minimum
window size and enlarged interface text preserve the same reachable actions and complete content.

## Configurable everyday tools

Allow people to pin, reorder and unpin contextual commands in a compact toolbar, with a separate
arrangement for each kind of plane. Supply a small useful starting set and keep the complete action
catalog available. Preserve customization across restart and updates; changing the toolbar never
changes the underlying command's permissions or execution requirements.

Acceptance: configure image, folder and development tools; reopen their views and restart. Toolbar,
menu and shortcut invocations act on the same selection. Unavailable actions explain their state; an
absent saved action remains repairable.

## Predictable responsiveness

Measure first usable content, input feedback, warm reopening and cancellation separately. Keep
unchanged document data reusable within bounded caches, after fresh source authorization. Culling a
view releases mounted resources without discarding the person's reading or editing position.

Heavy indexing, decoding and transformation work stays bounded and cancellable. A cancelled result
cannot replace a later request. Closing a workspace releases its listeners, resource leases and
temporary process ownership. Cold restoration never replays execution.

Acceptance: measure representative small and large files, 20 mixed planes and repeated reopen
cycles. Compare cold and warm timings, retained resources and input delays. Record hardware and
measurement limits; functional offscreen checks are not claims about physical display frame rate.

## Discoverable capabilities

Offer a contextual “What can I do here?” view listing applicable actions, keyboard shortcuts and
supported gestures from their existing definitions. Include plain-language descriptions and a clear
explanation of actions requiring a selection or different context. Let people execute or pin an
action without learning a command language.

Local command and file search remain deterministic. Exact matches take priority; typo suggestions
offer an explicit choice and never execute themselves. Distinguish filename search, content search
and optional model requests. Built-in browsing, previewing and editing remain useful offline.

Acceptance: a newcomer can find an unfamiliar action from the active file or folder. An experienced
user can find and invoke it by shortcut or command. Typo recovery preserves the intended target and
requires an affirmative selection.

## Task-based usability qualification

Maintain a repeatable task set: locate a document by name and content, rename files, edit and save,
compare and export, recover an error, customize tools, back up work and resume after restart. Cover
newcomer and experienced workflows, pointer and keyboard input, minimum windows and accessibility.

Record automated evidence separately from observed human sessions. Track completion, hesitation,
accidental actions and recovery. A large passing test count does not substitute for observing a
person complete a task. Keep run-specific recordings, timings and failures with generated evidence.

## Delivery order

1. Establish keyboard, focus, scrollbar and visible-control behavior and its regression coverage.
2. Add durable backup, import and source relinking, with compatibility fixtures.
3. Add configurable contextual toolbars and contextual capability discovery.
4. Qualify warm reopening, responsiveness and resource lifetimes against the task set.

Each stage uses existing owners, shared types and scoped desktop authority. Update the canonical
user instructions with the finished behavior. Preserve generated fixtures and original work
throughout implementation and validation.
