// @vitest-environment jsdom
/**
 * The shared words of the interface: counts with their nouns, titles in the macOS case, keys as a
 * Mac menu shows them, states in words, and the one failure with Try Again.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plural, pluralWord } from '../src/domain/plural';
import { titleCase } from '../src/domain/title-case';
import {
  defaultShortcuts,
  shortcutFor,
  shortcutGlyphs,
  withShortcut,
} from '../src/domain/preferences/shortcuts';
import { keyGlyphs } from '../src/domain/preferences/keymap';
import { capabilityLabel, operationLabel, statusLabel } from '../src/renderer/ui/status-labels';
import { Failure, tryAgainLabel } from '../src/renderer/ui/primitives';

afterEach(cleanup);

describe('plural', () => {
  it('says one thing in the singular and the rest in the plural', () => {
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(2, 'copy', 'copies')).toBe('2 copies');
    expect(pluralWord(1, 'match', 'matches')).toBe('match');
  });

  it('groups thousands as US English does, whatever the machine', () => {
    expect(plural(12_345, 'row')).toBe('12,345 rows');
  });
});

describe('titleCase', () => {
  it.each([
    ['New folder with selection…', 'New Folder with Selection…'],
    ['Open in default app', 'Open in Default App'],
    ['Move to Trash', 'Move to Trash'],
    ['Copy to…', 'Copy To…'],
    ['What can I do here?', 'What Can I Do Here?'],
    ['Chat about files', 'Chat About Files'],
    ['Zoom in', 'Zoom In'],
    ['Save PDF copy', 'Save PDF Copy'],
    ['Show in macOS Finder', 'Show in macOS Finder'],
    ['Rename “my old notes” again', 'Rename “my old notes” Again'],
    ['Change space background opacity (%)', 'Change Space Background Opacity (%)'],
  ])('%s becomes %s', (sentence, title) => {
    expect(titleCase(sentence)).toBe(title);
  });
});

describe('key glyphs', () => {
  it('shows a saved shortcut as a Mac menu does, whatever case it was saved in', () => {
    expect(shortcutGlyphs('Cmd+Shift+N')).toBe('⇧⌘N');
    expect(shortcutGlyphs('cmd+arrowup')).toBe('⌘↑');
    expect(shortcutGlyphs('Cmd+Enter')).toBe('⌘↩');
    expect(shortcutGlyphs('Cmd+Backspace')).toBe('⌘⌫');
    expect(shortcutGlyphs('')).toBe('');
    expect(keyGlyphs('Cmd+ArrowLeft')).toBe('⌘←');
  });

  it('follows a remap, and says nothing for a cleared shortcut', () => {
    expect(shortcutFor({}, 'palette')).toBe(defaultShortcuts.palette);
    expect(shortcutFor({ palette: 'Cmd+P' }, 'palette')).toBe('Cmd+P');
    expect(shortcutFor({ palette: '' }, 'palette')).toBe('');
    expect(withShortcut('Commands', shortcutGlyphs(shortcutFor({}, 'palette')))).toBe(
      'Commands (⌘K)',
    );
    expect(withShortcut('Commands', '')).toBe('Commands');
  });
});

describe('states in words', () => {
  it('never shows a stored value', () => {
    expect(statusLabel('queued')).toBe('Waiting');
    expect(statusLabel('cancelled')).toBe('Canceled');
    expect(statusLabel('waiting-review')).toBe('Needs review');
    expect(operationLabel('mkdir')).toBe('New Folder');
    expect(capabilityLabel('terminal-read')).toBe('Read terminal output');
  });
});

describe('Failure', () => {
  it('says what failed and offers Try Again last, after the other ways on', () => {
    const retry = vi.fn();
    render(
      <Failure title="Can't show this file" detail="It is damaged." onRetry={retry}>
        <button>Open in Default App</button>
      </Failure>,
    );
    expect(screen.getByText("Can't show this file")).toBeTruthy();
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Open in Default App', tryAgainLabel]);
    expect(tryAgainLabel).toBe('Try Again');
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('has no empty action row when nothing can be done', () => {
    const { container } = render(<Failure title="This plane is closed" />);
    expect(container.querySelector('.empty-actions')).toBeNull();
  });
});
