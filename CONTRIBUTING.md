# Work on Viewer

The maintained app is in `packages/viewer-electron/app`. Run the package commands from the
repository root.

Start with [building](docs/development/builds.md), the
[architecture](docs/development/architecture.md) and [testing](docs/development/testing.md).
[CONTEXT.md](CONTEXT.md) maps feature ownership. [PRODUCT.md](PRODUCT.md) describes the product;
[DESIGN.md](DESIGN.md) records current interface rules.

## Before a change

Read [AGENTS.md](AGENTS.md), including the exact-scope removal policy. Inspect the existing
implementation and tests. Preserve unrelated edits and generated fixtures. Prefer the existing
feature owner to a parallel service or registry.

Use top-level `import type` declarations. Inline type imports are rejected in source, tests and
tools; React test fixtures are included in type checking.

## Write documentation people can follow

- Put user instructions in a guide and exact syntax/limits in one reference.
- Keep `docs/` to its index and seven sections: `guides`, `reference`, `development`, `adr`,
  `research`, `release` and `media`. Each section has an index; add new pages there rather than
  creating top-level duplicates or forwarding pages.
- Lead with the action: numbered steps, exact labels in bold, keys beside them. Teach everyday work
  before introducing abstractions.
- Write short sentences. No em dashes anywhere, and on reader pages no filler such as "simply",
  "useful", "familiar" or "rather than"; `pnpm docs:check` refuses both.
- Match current command names, settings and behavior. Label proposals as research.
- Update the relevant guide when behavior changes; the README is an introduction.
- Keep routine test counts, candidate paths and execution diaries in generated evidence, rather than
  appending them to product documents.
- Use relative repository links and portable example paths. Public screenshots, clips and logs must
  exclude personal paths, credentials and unrelated files.
- Explain why a non-obvious invariant exists in a comment. Avoid dates, personal references and
  prose that repeats the next line of code. Preserve meaningful protocol/migration context and tool
  directives.

Run `pnpm docs:check` for documentation changes. `pnpm docs:media` reproduces recordings in an
isolated sample workspace; see [media production](docs/media/README.md).

## Verify the change

Run the affected tests, types, lint and formatting. Exercise changed user flows in the real app.
[Testing](docs/development/testing.md) distinguishes unit, browser, native and release evidence and
explains fixture preservation.

For a preview module, follow [the extension guide](docs/development/previews.md). For a new
ownership rule, record the decision in an [ADR](docs/adr/README.md).
