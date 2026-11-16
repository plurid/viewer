# Alpha versioning

Status: accepted.

## Decision

Viewer follows the owner's [alpha versioning](https://github.com/ly3xqhl8g9/alpha-versioning)
convention. Development starts at `0.0.0-0`. The first release is `0.1.0-0`:

- The ender is 0 while development continues. `1.0.0` is the last version, reserved for the end.
- The launcher is 1 because Viewer has launched.
- The revisioner is 0. Only an owner-declared general revision changes the third number.
- The developmenter N counts releases from 0. The next release is `0.1.0-1`.

The manifest's `version` is the single source of the alpha version. After cutting a release, the
owner runs `pnpm version:next` to raise only N and commits the next release's version. The release
tool refuses a version whose local `v<version>` tag already exists.

The build number is separate. Direct builds use the commit count from `tools/build-number.ts`, with
complete Git history and no rewriting of published history. Store builds use their own
`VIEWER_MAS_BUILD` number. About shows it in brackets after the alpha version.

| Field                        | First direct release, build 584 |
| ---------------------------- | ------------------------------- |
| App manifest `version`       | `0.1.0-0`                       |
| `CFBundleShortVersionString` | `0.1.0-0`                       |
| `CFBundleVersion`            | `584`                           |
| Feed `version` / `build`     | `0.1.0-0` / `584`               |

The Mac App Store requires three period-separated integers that increase for each release. Its
bundle short version drops the alpha ender: `0.1.0-0` maps to `1.0.0`, `0.1.0-N` to `1.0.N`, and
`0.1.1-0` to `1.1.0`. This is the owner's allowed Store exception. The mapping is derived from the
manifest, with no second version to maintain. The copied manifest keeps the alpha version before
ASAR creation and signing, so Electron and all in-app surfaces still report `0.1.0-0`.

Release `0.1.0-0` is tagged `v0.1.0-0` at its source commit. Its installer is
`Viewer-0.1.0-0-arm64.dmg`. Packaged Help links use the version tag; development links use `master`.
Development runs show the alpha version, are labelled development, and receive no update offers.

## Consequences

The feed accepts only alpha versions with an ender of 0. Updates compare all four numbers
numerically, then compare builds for equal versions. Thus `0.1.0-10` follows `0.1.0-1`, and two
builds of one release can still be ordered. Dotted macOS system versions keep their own comparison.

The event build of 2026-11-03 was named `1.0.0` (build 553). It was withdrawn on 2026-11-16, with
its GitHub releases and `v1.0.0` tag. Its commit, `1a0dcf04e50fa4c74f506ea07035a52da68d4a04`, stays
in history. A copy installed from that build does not receive `0.1.0-N` through Check for Updates,
because the dotted version is lower. Install the first release over it once by hand. No exception
for `1.0.0` belongs in the app.

Each release has its own committed notes file, starting with `release-notes/0.1.0-0.txt`. Empty or
missing notes still stop the release. The old `release-notes/1.0.0.txt` stays as the event build's
record.

The four generated license files stay ignored. Their source link uses `v<version>` from the
manifest, independently of the build number.

[Release procedure](../development/releases.md)
