import { diagnosticFailure } from '../../domain/diagnostics/failure';
import { errorMessage } from '../../domain/errors';

export function reportPreviewProblem(error: unknown): void {
  void window.viewer?.diagnosticReport?.(diagnosticFailure(error)).catch(() => {});
}

/** A decoder can throw arbitrary text from a file. Only known reader messages reach the card. */
export function previewProblem(
  error: unknown,
  fallback: string,
  readerMessages: readonly (string | RegExp)[] = [],
): string {
  reportPreviewProblem(error);
  const message = errorMessage(error);
  const known = readerMessages.some((reason) =>
    typeof reason === 'string' ? reason === message : reason.test(message),
  );
  if (known || message === 'This preview resource has expired.') return message;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'The file has moved or is no longer available.';
  if (code === 'EPERM' || code === 'EACCES' || code === 'FILE_ACCESS_REQUIRED')
    return 'Viewer needs permission to read this file.';
  if (
    (error instanceof Error && error.name === 'PasswordException') ||
    /^(?:protected document|(?:incorrect|invalid) password|no password given|password required)\.?$/i.test(
      message,
    )
  )
    return 'The file is protected. Open it in its own app.';
  if (/exceeds? .*(?:limit|budget)|too large/i.test(message))
    return 'The file is too large for this preview.';
  if (/timed? out|took too long/i.test(message)) return 'Reading this file took too long.';
  return fallback;
}
