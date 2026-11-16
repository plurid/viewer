# Alpha versioning

Status: accepted.

## Decision

Viewer follows the owner's [alpha versioning](https://github.com/ly3xqhl8g9/alpha-versioning)
convention. Development starts at `0.0.0-0`. The launched application uses `0.1.0-N`:

- The ender is 0 while development continues. `1.0.0` is the last version, reserved for the end.
- The launcher is 1 because Viewer has launched.
- The revisioner is 0. Only an owner-declared general revision changes the third number.
- The developmenter N is the build number already assigned to this copy.

Every commit is a development update. Direct builds use the commit count from
`tools/build-number.ts`, with complete Git history and no rewriting of published history. This
avoids a second counter that someone must maintain by hand. Store builds use the Store's own build
number, `VIEWER_MAS_BUILD`.

Apple's short version and the signed feed schema require three dotted numbers. Keep the version
and build separate in those fields:

| Field | Value for build 580 |
| --- | --- |
| App manifest `version` | `0.1.0` |
| `CFBundleShortVersionString` | `0.1.0` |
| `CFBundleVersion` | `580` |
| Feed `version` / `build` | `0.1.0` / `580` |

`releaseName` beside `InstalledRelease` composes `0.1.0-580` for people and links. Without a build
it returns `0.1.0`; About identifies that run as development. Releases are tagged `v0.1.0-580`
at their source commit. Packaged Help links use the full tag; development links use `master`.

## Consequences

The app already offers the same version with a later build, so `0.1.0-600` updates `0.1.0-580`
without a new ordering rule. Direct and Store tooling have no check requiring the new version to
exceed a published version.

The first public build was published as `1.0.0` (build 553) before this rule. Those copies do not
receive `0.1.0-N` through Check for Updates, because the dotted version is lower. Their owners
install the new release once by hand. No exception for `1.0.0` belongs in the app. Keep the
`v1.0.0` tag because those copies' Help links point to it.

`release-notes/0.1.0.txt` holds the notes for the release being cut and is rewritten and committed
for each release. Earlier notes remain in Git history and each published feed. Empty or missing
notes still stop the release. The old `release-notes/1.0.0.txt` stays as history.

The generated third-party notices are committed, so their source link cannot include their own
commit count. It points to `master`; it no longer claims to identify an exact release tag.

[Release procedure](../development/releases.md)
