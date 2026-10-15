/** A readable message for anything thrown, including non-Error values. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
