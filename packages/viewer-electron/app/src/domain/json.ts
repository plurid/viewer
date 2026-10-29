/** Equal as JSON text, so key order counts: for values built the same way, such as settings. */
export const sameJSON = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
