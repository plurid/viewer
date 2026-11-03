/** Release identity fixed at build time. The app, the Forge configuration and the release tooling
 * read the same values; this module imports nothing so each of them can load it. */
export const applicationCopyright = 'Copyright © 2020-2026 Plurid';

export interface UpdateFeedConfiguration {
  /** The signed feed's https address. Its signature is the same address with `.sig` appended. */
  url: string;
  /** Base64 of the Ed25519 public key (DER SubjectPublicKeyInfo) that `pnpm updates:keys` prints. */
  publicKey: string;
}

/** GitHub hosts release assets; the signature authenticates the feed across download redirects. */
export const updateFeedConfiguration: UpdateFeedConfiguration = {
  url: 'https://github.com/plurid/viewer/releases/latest/download/viewer-update.json',
  publicKey: 'MCowBQYDK2VwAyEAjeigzYqlIoiO1/CtSbz36yMylQVVvh5aisaQBCmH7EU=',
};
