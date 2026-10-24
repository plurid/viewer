# 0002: Require private version-2 authority for shared agents

Accepted: October 24, 2026.

## Context

Editable JSONC can request agent access but cannot prove that a person approved it.
Version-1 shared authority does not distinguish configuration-seeded values from
native consent. Importing settings or restoring a presentation profile must not
enable agents, add folders or widen their capabilities.

## Decision

`desktop/agents/agent-access.ts` owns `agent-access-v2.json`. Version 2 is the only
shared-connection authority. Effective enabled state and folders are the
intersection of private approval and current requested configuration. Configuration
may narrow approval immediately; turning access back on or restoring a removed
folder becomes a new request. An unavailable configuration does not manufacture
consent or destructively rewrite stored approval.

Every positive enable/folder/capability change requires the Settings-only native
review path. The desktop captures configuration revision, canonical paths,
identities and authority generation before confirmation. Its opaque review is
single-use; approval rechecks the same request and generation before publishing.
Renderer-supplied approval flags or replayed review objects cannot grant access.

Legacy version-1 data supplies protected-path/reapproval context, never authority.
Unreadable version-2 data grants nothing and is preserved before an explicit review
replaces it. Named clients retain their separate private credentials, scopes,
capabilities, task ownership and revocation. Native filesystem scopes and model
endpoint/data consent remain independent boundaries for every client.

## Consequences

Older shared clients require one explicit native review. Configuration exports and
backups remain portable preferences, not authorization backups. Agents cannot gain
opaque shell, executable or terminal-input routes through aliases or stored grants.
Trash proposals continue through native desktop review, captured versions and the
ordinary operation queue; no failure permits permanent-removal fallback.

Source and service tests verify denial, stale/replayed reviews and migration.
Physical affirmative consent and signed Store behavior require their own acceptance
evidence; fixture checks do not establish either result.

Evidence: `agent-access.test.ts`, `agent-safety.test.ts`,
`reviewed-removal.test.ts`, `file-review-native.test.ts` and the release ledger.
