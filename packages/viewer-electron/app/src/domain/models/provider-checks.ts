/** Fixed no-file checks. Callers cannot provide prompts, schemas, headers or endpoints. */
export const providerCheckKinds = ['text', 'simple-schema', 'chat-schema'] as const;
export type ProviderCheckKind = (typeof providerCheckKinds)[number];

export interface ProviderCheckRequest {
  providerID: string;
  kind: ProviderCheckKind;
}

export interface ProviderCheckResult {
  providerID: string;
  kind: ProviderCheckKind;
  outcome: 'passed' | 'http-error' | 'invalid-response' | 'connection-error';
  httpStatus?: number;
  /** Bounded fixed-input diagnostic, with credential redaction performed only in main. */
  detail: string;
}
