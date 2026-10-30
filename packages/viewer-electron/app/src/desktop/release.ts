/** Release identity fixed at build time. The app, the Forge configuration and the release tooling
 * read the same values; this module imports nothing so each of them can load it. */
export const applicationCopyright = 'Copyright © 2020-2026 Plurid, Inc.';

export interface UpdateFeedConfiguration {
  /** The signed feed's https address. Its signature is the same address with `.sig` appended. */
  url: string;
  /** Base64 of the Ed25519 public key (DER SubjectPublicKeyInfo) that `pnpm updates:keys` prints. */
  publicKey: string;
}

/** Empty until the release owner sets both (docs/development/releases.md). With either empty,
 * Check for Updates says this build has no update feed and the launch check does nothing. */
export const updateFeedConfiguration: UpdateFeedConfiguration = {
  url: '',
  publicKey: '',
};
