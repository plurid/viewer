/**
 * The first-run hint names Quick preview, the command palette and Frame all, plus title dragging.
 * Each step it teaches leaves the card once it has been used; with all used, or the card
 * dismissed, it retires for good.
 */
// in the card's order: the small action first
export const firstRunSteps = ['quick-preview', 'palette', 'frame-all'] as const;
export type FirstRunStep = (typeof firstRunSteps)[number];
/**
 * The steps used so far, or retired. Only a new configuration starts one (desktop
 * preferences/settings.ts): a profile made before it holds none and never shows the card.
 */
export type FirstRunHint = { used: FirstRunStep[] } | 'retired';

export const freshFirstRunHint = (): FirstRunHint => ({ used: [] });

/** The hint once `step` has been used: the same hint when it records nothing new. */
export function firstRunHintAfter(
  hint: FirstRunHint | undefined,
  step: FirstRunStep,
): FirstRunHint | undefined {
  if (!hint || hint === 'retired' || hint.used.includes(step)) return hint;
  const used = [...hint.used, step];
  return firstRunSteps.every((item) => used.includes(item)) ? 'retired' : { used };
}

/** The steps the card still names; none once it has retired or was never started. */
export const firstRunStepsLeft = (hint: FirstRunHint | undefined): FirstRunStep[] =>
  hint && hint !== 'retired' ? firstRunSteps.filter((step) => !hint.used.includes(step)) : [];

/** A saved hint, kept as it was where valid; anything else is no hint. */
export function normalizeFirstRunHint(value: unknown): FirstRunHint | undefined {
  if (value === 'retired') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const used = (value as { used?: unknown }).used;
  if (!Array.isArray(used)) return undefined;
  const steps = firstRunSteps.filter((step) => used.includes(step));
  return steps.length === firstRunSteps.length ? 'retired' : { used: steps };
}
