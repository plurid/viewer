/**
 * A SEE-THROUGH SPACE (2026-10-23): the space between planes may show what is behind Viewer's window,
 * blurred or clear, at a chosen opacity; the planes stay opaque.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePreferences } from '../src/domain/preferences';
import { backdropWindowOptions, backdropChange } from '../src/desktop/backdrop';

describe('the space backdrop preference', () => {
  it('is opaque by default, at 60% when made see-through', () => {
    expect(normalizePreferences().space).toMatchObject({ backdrop: 'opaque', backdropOpacity: 60 });
  });
  it('keeps a valid choice and bounds the opacity', () => {
    const space = (value: unknown) =>
      normalizePreferences({ version: 3, space: value } as never).space;
    expect(space({ backdrop: 'blur', backdropOpacity: 35 })).toMatchObject({
      backdrop: 'blur',
      backdropOpacity: 35,
    });
    expect(space({ backdrop: 'glass', backdropOpacity: 250 })).toMatchObject({
      backdrop: 'opaque',
      backdropOpacity: 100,
    });
  });
});

describe("the window's backdrop", () => {
  it('blurs with vibrancy, or is created transparent for a clear backdrop', () => {
    expect(backdropWindowOptions('opaque', 'dark')).toEqual({ backgroundColor: '#272a30' });
    expect(backdropWindowOptions('blur', 'dark')).toEqual({
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    });
    expect(backdropWindowOptions('clear', 'light')).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
    });
  });
  it('switches blur live, and waits for a new window to become clear or stop being clear', () => {
    expect(backdropChange('opaque', 'blur')).toBe('live');
    expect(backdropChange('blur', 'opaque')).toBe('live');
    expect(backdropChange('blur', 'clear')).toBe('reopen');
    expect(backdropChange('clear', 'opaque')).toBe('reopen');
    expect(backdropChange('clear', 'clear')).toBe('live');
  });
});

describe('what is see-through', () => {
  const css = readFileSync(new URL('../src/renderer/styles/base.css', import.meta.url), 'utf8');
  it("is the space's grid floor alone: the title bar, sidebar and plurid's colours stay", () => {
    expect(css).toMatch(
      /\[data-backdrop='clear'\] \.workspace-surface \[data-plurid-entity='PluridSpace'\]/,
    );
    // plurid's space colour also fills its palette and shortcut backdrops: it is not overridden
    expect(css).not.toMatch(/--plurid-space:\s*transparent/);
    expect(css).toMatch(/\[data-backdrop='clear'\] :is\(\.app-titlebar, \.location-sidebar\)/);
  });
  it("draws plurid's controls solid, so a plane behind them does not show through", () => {
    expect(css).toMatch(/--plurid-opacity-persistent: 1;/);
    expect(css).toMatch(/--plurid-surface: var\(--plurid-surface-solid\);/);
  });
});
