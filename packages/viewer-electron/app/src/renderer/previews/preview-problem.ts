import { diagnosticFailure } from '../../domain/diagnostics/failure';
import { knownPreviewProblem } from '../../domain/previews/reader-problem';

export function reportPreviewProblem(error: unknown): void {
  void window.viewer?.diagnosticReport?.(diagnosticFailure(error)).catch(() => {});
}

/** A decoder can throw arbitrary text from a file. Only known reader messages reach the card. */
export function previewProblem(error: unknown, fallback: string, extension?: string): string {
  reportPreviewProblem(error);
  return knownPreviewProblem(error, extension) ?? fallback;
}
