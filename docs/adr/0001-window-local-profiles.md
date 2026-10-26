# 0001: Resolve setting profiles as window-local overlays

Accepted: October 24, 2026.

## Context

Applying a presentation profile by patching shared configuration changes other windows. Restoring a
captured previous value can then overwrite a newer Settings edit. A profile must also reach folder
defaults, editor fonts, Tour settings and native appearance through one interpretation of the same
fields.

## Decision

Keep canonical Settings shared. Resolve each owning workspace window as shared defaults, workspace
default profile, explicitly selected profile, then local workspace overrides. Folder presentation
adds shared path-specific overrides and project folder views after those resolved defaults. Native
and renderer adapters use `domain/preferences/presentation/resolver.ts`; neither activation nor
leaving a profile writes canonical configuration.

Only leaves in `profile-fields.ts` are valid: UI presentation, appearance, browsing defaults
excluding session restoration/Trash confirmation, editor/terminal fonts, tiling, Tour and chosen
theme IDs. Credentials, consent, provider definitions, agent scopes, commands, process-global
switches and shared catalogs cannot become window overlays. Parent shorthand expands only through
this same schema; unknown siblings invalidate the shorthand and explicit leaves win independent of
JSON order.

Settings edits shared defaults. A generic supported workspace command edits local overrides while a
profile is active and otherwise retains its shared behavior. Explicit `@workspace`/`:setlocal`
commands always remain local. An override equal to its inherited profile value is removed. Leaving
an explicit profile reveals the workspace default and retained local choices.

Definitions are shared by ID and revisions take effect live. Deleted references remain saved with a
diagnostic and inherited fallback, so users can repair them. Built-in IDs are reserved. Legacy
unsupported definitions remain readable with warnings; new invalid definitions/imports are rejected.
OS appearance is supplied separately so a system-following window cannot inherit another window's
override.

## Migration and consequences

Saved state is version 7. Storage preserves the exact bytes of versions 1–6 before returning
upgraded state. The startup restoration planner compares old global profile values against current
canonical values before proposing a restoration. Newer edits, conflicting windows, unavailable
profiles and unsupported prior fields remain intact with diagnostics. Returned migration state is
adopted only after its revisioned configuration patches succeed. Protected authority is never
restored from a profile record.

Effective values share untouched objects and cache immutable profile compilation. Window-local state
remains separate from shared consent and desktop services. Adding a supported field requires its
shared schema, runtime consumers and tests for workspace switching, independent windows, shared
edits, deletion and reopen.

Evidence: `presentation.test.ts`, `profiles.test.ts`, `profile-settings.test.ts`,
`profile-migration.test.ts`, `workspace-overrides.test.ts`, `workspace-sessions.test.ts` and
`saved-state-v5.test.ts`.
