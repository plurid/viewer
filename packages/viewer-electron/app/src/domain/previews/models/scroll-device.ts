/**
 * How a 3D preview reads the wheel: a mouse wheel zooms, a trackpad's two-finger scroll pans.
 * Automatic tells them apart from each burst of events.
 */
export const modelScrollDevices = ['automatic', 'mouse', 'trackpad'] as const;
export type ModelScrollDevice = (typeof modelScrollDevices)[number];
