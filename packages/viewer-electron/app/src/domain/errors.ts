/** Convert validation issues into a readable error message. */
function issuesText(
  issues: readonly { path?: readonly PropertyKey[]; message?: string }[],
): string {
  return issues
    .slice(0, 3)
    .map((issue) => {
      const path = (issue.path ?? []).map(String).join('.');
      const message = (issue.message ?? 'Invalid value').replace(/^Invalid input: /, '');
      return path ? `${path}: ${message}` : message;
    })
    .join('; ');
}
/** A readable message for anything thrown, including non-Error values. */
export function errorMessage(error: unknown): string {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (Array.isArray(issues) && issues.length) return issuesText(issues);
  return error instanceof Error ? error.message : String(error);
}
