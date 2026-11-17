/**
 * Known false alarms: findings that are the design, not a defect. Each entry names the check, the
 * element and why it is allowed. Allowed findings still show in the report, greyed, so a reason
 * that stops holding is seen.
 */
import type { CheckID, Finding } from './types';

export interface Allowance {
  check: CheckID;
  /** Matches the finding's selector. */
  selector: RegExp;
  /** Matches the finding's text, when the selector alone is too broad. */
  text?: RegExp;
  /** Matches the scene id, when only some scenes show it. */
  scene?: RegExp;
  /** Matches the variant id, when only some window sizes or appearances show it. */
  variant?: RegExp;
  reason: string;
}

export const allowances: readonly Allowance[] = [];

/** Marks the findings an allowance covers with its reason. */
export function applyAllowances(
  findings: readonly Finding[],
  scene: string,
  variant: string,
  list: readonly Allowance[] = allowances,
): Finding[] {
  return findings.map((finding) => {
    const allowance = list.find(
      (item) =>
        item.check === finding.check &&
        item.selector.test(finding.selector) &&
        (!item.text || item.text.test(finding.text)) &&
        (!item.scene || item.scene.test(scene)) &&
        (!item.variant || item.variant.test(variant)),
    );
    return allowance ? { ...finding, allowed: allowance.reason } : finding;
  });
}
