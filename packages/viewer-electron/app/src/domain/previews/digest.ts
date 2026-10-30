/** A hash the caller computes, as lowercase hexadecimal: the domain has no digest of its own. */
export type Digest = (algorithm: 'sha1' | 'sha256', bytes: Uint8Array) => string;
