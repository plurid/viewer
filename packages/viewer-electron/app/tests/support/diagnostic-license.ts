/** A complete issuer-shaped token with recognizable bytes for persisted-fragment assertions. */
export const licensePayload = Buffer.from(
  JSON.stringify({
    product: 'viewer',
    email: 'fixture@example.invalid',
    order: 'hunter2',
    issued: '2026-11-18',
  }),
).toString('base64url');
export const licenseSignature = 'abcdefghijklmno'.repeat(5) + 'J7qxB5nvZ8A';
