import { vi } from 'vitest';

/**
 * jsdom lays nothing out, so a virtualized list sees a zero-sized scroller and renders no rows.
 * Give every element the same client and offset box: virtual-core reads the client box, and
 * other measurements read the offset box.
 */
export function mockElementBox(width: number, height: number): void {
  const sizes = {
    clientWidth: width,
    clientHeight: height,
    offsetWidth: width,
    offsetHeight: height,
  } as const;
  for (const [name, value] of Object.entries(sizes))
    vi.spyOn(HTMLElement.prototype, name as keyof typeof sizes, 'get').mockReturnValue(value);
}
