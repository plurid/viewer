/** Renderer startup milestones, visible in DevTools and read by the responsiveness harness. */
export type StartupMark = 'viewer:bootstrap' | 'viewer:first-rows';

const marked = new Set<StartupMark>();

export function markStartup(name: StartupMark): void {
  if (marked.has(name)) return;
  marked.add(name);
  performance.mark(name);
}
