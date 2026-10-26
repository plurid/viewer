# Test the behavior you changed

Run checks from the repository root. Use the smallest relevant regression first, then broaden for
shared contracts, persistence, permissions or runtime changes.

## Source checks

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm docs:check
```

Types cover main, preload, renderer and tooling. Tests cover pure rules, component behavior and
desktop services. Passing these does not qualify native pickers, Finder, physical accessibility or a
distribution package.

## Browser and packaged checks

`pnpm test:browser` serves the renderer with isolated filesystem fixtures. Its
picker/clipboard/Trash adapters are synthetic. It is useful for renderer behavior, not proof of real
OS integration.

After packaging, run the actual binary with fixture preservation and removal disabled. The default
desktop binary is the regular packaged output; use `VIEWER_TEST_BINARY` for a retained candidate.

```sh
VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 pnpm test:desktop
```

Routine native tests use hidden offscreen windows, isolated profiles and generated files. They keep
the QA app out of the Dock and check it never becomes active. Run one native scenario at a time when
it owns native dialogs or shared platform resources. Never modify the user's running profile to make
a test pass.

## Focused native scenarios

The app's `tests/native/` directory contains scenario drivers for Office layout, preview
restoration/recovery, mixed workspaces, task workflows, media and other features. Run them with the
same preservation variables and candidate binary. Their result identifies retained inputs, captures
and failures.

Mixed-workspace auditing supports 3–50 close/reopen cycles and optional heap snapshots. Track
retaining paths and owned lifetimes, not just total DOM counts. The known OrbitControls and
shared-texture leaks have separate regressions.

Use larger public files as well as generated samples: paginated PDFs, complex Office documents,
textured models and long media. Pin source hashes, preserve originals, inspect actual rendered
content, and test cancellation and a cold restart.

## What evidence means

| Check                     | Establishes                                            |
| ------------------------- | ------------------------------------------------------ |
| Source/unit/component     | The exercised rule and mocked/service contract         |
| Browser harness           | Renderer behavior with its stated fixture adapters     |
| Packaged native           | The exercised binary, OS, architecture and integration |
| Foreground trace          | Physical-window observations for the exact workload    |
| Cross-platform CI         | Only the platforms and cases that actually ran         |
| Signed release acceptance | Separate distribution/runtime gates                    |

Hidden-window intervals are scheduling observations, not display FPS. Summed process RSS includes
shared pages and heap-snapshot overhead; it is not unique physical or private GPU memory. Record
residual growth instead of claiming all caches stabilize indefinitely.

## Preserve useful evidence

Write run-specific logs, profiles, heap snapshots, hashes and screenshots to generated output.
Public docs explain reproduction and current limits rather than accumulating candidate names and
historical test counts. Report passed, failed, skipped and unexecuted checks distinctly.

Fixtures and failed artifacts remain until exact-path removal is approved. Human removal/consent
confirmations must be clicked by the operator when required; agents never approve their own removal.
See [AGENTS.md](../../AGENTS.md) and [release gates](releases.md).
