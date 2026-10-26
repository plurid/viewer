# Platform and build status

Viewer is a desktop application with platform-specific native services. A shared renderer or passing
source test does not establish complete support on another OS.

| Target              | Current qualification                                              |
| ------------------- | ------------------------------------------------------------------ |
| Apple Silicon macOS | Local developer packages and native workflows exercised            |
| Intel macOS         | Build paths exist; separate native acceptance is required          |
| Windows             | Shared application work and adapters need executable qualification |
| Linux               | Shared application work and adapters need executable qualification |
| Mac App Store       | Separate sandbox, entitlement, signing and release gates           |

The current Electron runtime sets the native macOS minimum; build tooling reads that target rather
than the build machine's SDK default. The current local build requires macOS 13 or later.
[Building](../development/builds.md) describes the supported development setup.

## Feature-specific differences

The bundled Office WebAssembly engine is included on all three desktop targets. Its real-engine
macOS smoke passes; Windows/Linux CI runs remain pending.

Native image/RAW renderers, Spotlight tags, external terminal integration and packaged media/PDF
processors have platform-specific implementations or current macOS build limits. A previewable
extension on macOS is not a cross-platform codec promise.

Direct macOS and Store builds use different file-access and worker strategies. Store folder
bookmarks do not grant Full Disk Access, and direct-build access does not establish sandbox
acceptance.

## Distribution

The documented local package uses ad-hoc signing. Certificate signing, notarization and Store
distribution have their own release checks. This repository does not represent a local test
candidate as a publicly qualified installer.

See [release gates](../development/releases.md) for native permission, privacy, accessibility,
architecture and distribution checks.
