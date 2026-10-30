// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViewerAPI } from '../src/domain/contracts';
import type { SettingsSnapshot } from '../src/domain/services';
import { buttonState, patchSettings, pressButton } from './native/runtime/page';

/** Runs a page expression in this document, as CDP does in the renderer. */
const run = (expression: string): unknown => (0, eval)(expression);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('page helpers', () => {
  it('reads a button by its label, inside a scope when given', () => {
    document.body.innerHTML = `
      <button> Save </button>
      <dialog open><button disabled>Save</button><button>Cancel</button></dialog>`;
    expect(run(buttonState('Save'))).toBe('enabled');
    expect(run(buttonState('Save', 'dialog'))).toBe('disabled');
    expect(run(buttonState('Cancel', 'nav'))).toBe('missing');
  });

  it('presses an enabled button and refuses a missing or disabled one', () => {
    document.body.innerHTML = '<button>Done</button><button disabled>Retry</button>';
    const pressed = vi.fn();
    document.querySelector('button')!.addEventListener('click', pressed);
    run(pressButton('Done'));
    expect(pressed).toHaveBeenCalledOnce();
    expect(() => run(pressButton('Retry'))).toThrow('Unavailable button: Retry');
    expect(() => run(pressButton('Done', 'dialog'))).toThrow('Unavailable button: Done');
  });

  it('patches settings at the revision it reads', async () => {
    const settingsPatch = vi.fn(async () => ({ revision: 8 }) as SettingsSnapshot);
    window.viewer = {
      settingsGet: async () => ({ revision: 7 }) as SettingsSnapshot,
      settingsPatch,
    } as Partial<ViewerAPI> as ViewerAPI;
    const look = { path: 'settings.appearance', value: 'light' };
    await run(patchSettings(look));
    expect(settingsPatch).toHaveBeenCalledWith([look], 7);
  });
});
