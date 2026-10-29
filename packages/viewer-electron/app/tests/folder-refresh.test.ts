// @vitest-environment jsdom
/**
 * A finished copy re-listed every open folder. A refresh now names the paths a job or file
 * change touched, and only folders holding them, or inside them, list again.
 */
import { expect, it } from 'vitest';
import { refreshConcerns, requestRefresh } from '../src/renderer/state/refresh';

function heard(paths?: string[]): Event {
  let event: Event | undefined;
  const listen = (value: Event) => (event = value);
  window.addEventListener('viewer:refresh', listen);
  requestRefresh(paths);
  window.removeEventListener('viewer:refresh', listen);
  return event!;
}

it('reaches the folders a change is in or under', () => {
  const copy = heard(['/Users/me/Documents/a.txt', '/Users/me/Copies']);
  expect(refreshConcerns(copy, '/Users/me/Documents')).toBe(true);
  expect(refreshConcerns(copy, '/Users/me/Copies')).toBe(true);
  expect(refreshConcerns(copy, '/Users/me')).toBe(true);
  expect(refreshConcerns(copy, '/Users/me/Pictures')).toBe(false);
  expect(refreshConcerns(copy, '/Users')).toBe(false);
  // a moved folder: what was inside it lists again too
  expect(refreshConcerns(heard(['/Users/me/Old']), '/Users/me/Old/Sub')).toBe(true);
});

it('reaches every folder without paths', () => {
  expect(refreshConcerns(heard(), '/anywhere')).toBe(true);
});
