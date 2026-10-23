/**
 * A SEE-THROUGH SPACE (2026-10-23): the space between planes may show what is behind Viewer's window,
 * blurred or clear, at a chosen opacity; the planes stay opaque.
 */
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
