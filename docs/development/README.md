# Develop Viewer

The maintained desktop app is `packages/viewer-electron/app`. Commands below run from the repository
root. Domain rules, desktop authority and renderer presentation are separate layers; extend an
existing feature owner before introducing another registry, cache, mutation path or persistence
format.

## Build and structure

- [Build and run](builds.md): install prerequisites, build native helpers, package locally and
  preserve earlier build outputs.
- [Architecture and boundaries](architecture.md): layer rules, IPC contracts, typed boundaries and
  shared interface controls.
- [Adding a preview](previews.md): add a file preview module and wire its format detection and
  resource limits.
- [Runtime dependencies](dependencies.md): bundled processors, native helpers, WebAssembly runtimes
  and third-party packages.

## Testing, review and quality

- [Testing and qualification](testing.md): source checks, unit tests, hidden-window native
  scenarios, canvas evaluation and saved-response replay.
- [Review every screen](review.md): run `pnpm review` to capture review sheets across appearances
  and sizes, and add new scenes.
- [Review findings](findings.md): open problems found by the whole-repository review, grouped by
  area and severity.
- [Sample playground](playground.md): generate and inspect the isolated sample workspace used for
  manual runs and recordings.
- [Qualify complete desktop tasks](usability.md): end-to-end human usability protocol covering
  keyboard, pointer and accessibility flows.
- [Performance and resource audits](performance.md): measure startup, warm reopen, memory, idle
  energy and long-session resource behavior.

## Release and decisions

- [Native and distribution release gates](releases.md): direct-build signing, notarization, signed
  update feeds, Mac App Store builds and `pnpm qualify`.
- [Architecture decisions](../adr/README.md): durable design and ownership records.
- [Domain map](../../CONTEXT.md): feature ownership across `src/domain`, `src/desktop` and
  `src/renderer`.

## Document the behavior

Follow [CONTRIBUTING.md](../../CONTRIBUTING.md) for code and documentation rules. User guides
explain tasks; references own exact behavior; [research](../research/README.md) holds proposals. The
[documentation media guide](../media/README.md) explains real-app recordings and public sample
provenance. Run `pnpm docs:check` to validate formatting, links and wording rules.
