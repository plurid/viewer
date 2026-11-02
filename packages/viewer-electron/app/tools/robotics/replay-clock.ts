/** Repair the retained canvas's first-frame clock without changing poses or robot calculations. */
export function repairReplayClock(html: string) {
  const original = 'const dt = (t - replayLast) / 1000;';
  const repaired = 'const dt = Math.max(0, (t - replayLast) / 1000);';
  if (!html.includes('function playReplay()') || html.includes(repaired))
    return { html, repaired: false };
  if (html.split(original).length !== 2)
    throw new Error('The retained replay clock does not match the reviewed repair.');
  // A queued animation frame can predate the click handler's performance.now() reading.
  return { html: html.replace(original, repaired), repaired: true };
}
