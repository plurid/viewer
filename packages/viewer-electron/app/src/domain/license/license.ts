import { z } from 'zod';

export const licenseLimits = { key: 4096, email: 320, order: 256 } as const;
export const trialDays = 30;
const day = 24 * 60 * 60 * 1000;
const quotePairs = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
] as const;

/** Purchase messages can add these copying artifacts without changing the signed payload. */
export function licenseKeyText(text: string): string {
  const compact = text.replace(/[\s\u200b\u200d\u2060\ufeff\u00ad]/g, '');
  return quotePairs.some(([open, close]) => compact.startsWith(open) && compact.endsWith(close))
    ? compact.slice(1, -1)
    : compact;
}

export const licensePayloadSchema = z.object({
  product: z.literal('viewer'),
  email: z.string().min(1).max(licenseLimits.email),
  order: z.string().trim().min(1).max(licenseLimits.order),
  issued: z.iso.date(),
});
export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export interface TrialRecord {
  started: number;
  seen: number;
}

export type LicenseStatus =
  | { kind: 'licensed'; email: string }
  | { kind: 'trial'; daysLeft: number }
  | { kind: 'trial-ended'; reminderHidden?: true };

export type LicenseRequest =
  | { kind: 'status'; hideReminder?: boolean }
  | { kind: 'enter'; key: string }
  | { kind: 'remove' }
  | { kind: 'buy' };

/** The observed span only grows, so correcting a wrong clock cannot extend the trial. */
export function advanceTrial(trial: TrialRecord | undefined, now: number): TrialRecord {
  return trial
    ? { started: Math.min(trial.started, now), seen: Math.max(now, trial.seen, trial.started) }
    : { started: now, seen: now };
}

export function trialStatus(trial: TrialRecord, now: number): LicenseStatus {
  const observed = advanceTrial(trial, now);
  const elapsed = observed.seen - observed.started;
  const daysLeft = Math.max(0, trialDays - Math.floor(elapsed / day));
  return daysLeft > 0 ? { kind: 'trial', daysLeft } : { kind: 'trial-ended' };
}

export function licenseLine(status: LicenseStatus | undefined): string | undefined {
  if (!status) return undefined;
  switch (status.kind) {
    case 'licensed':
      return `Licensed to ${status.email}`;
    case 'trial':
      return `Trial: ${status.daysLeft} ${status.daysLeft === 1 ? 'day' : 'days'} left`;
    case 'trial-ended':
      return 'Trial ended';
  }
}
