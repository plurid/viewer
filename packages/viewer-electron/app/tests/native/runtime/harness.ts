/** Typed CDP and bounded observation ports shared by native scenarios. */
export interface NativeScenarioHarness {
  evaluate<T>(expression: string): Promise<T>;
  command<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  until<T>(
    read: () => Promise<T>,
    accepts: (value: T) => boolean,
    label: string,
    timeout?: number,
  ): Promise<T>;
}
