# Develop Viewer

The maintained desktop app is `packages/viewer-electron/app`. Commands below run from the repository
root.

1. [Build and run](builds.md).
2. Read [architecture](architecture.md) and the [domain map](../../CONTEXT.md).
3. Run [affected tests](testing.md).

## Find the right owner

Domain rules, desktop authority and renderer presentation are separate layers. Extend an existing
feature owner before introducing another registry, cache, mutation path or persistence format.

- [Architecture and boundaries](architecture.md)
- [Adding a preview](previews.md)
- [Sample playground](playground.md)
- [Performance and resource audits](performance.md)
- [Native and distribution release gates](releases.md)
- [Architecture decisions](../adr/README.md)

## Document the behavior

Use [CONTRIBUTING.md](../../CONTRIBUTING.md) for code and documentation practice. User guides
explain tasks; references own exact behavior. Research is explicitly proposed. Routine qualification
output belongs in retained generated evidence.

The [documentation media guide](../media/README.md) explains real-app recordings and public sample
provenance. `pnpm docs:check` validates the documentation graph.
