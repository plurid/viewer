// @vitest-environment jsdom
/**
 * The shared controls of the layout batch: a file name that loses its middle and keeps its
 * extension, a number field that applies a draft once, and Finder keys for lists.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileName } from '../src/renderer/ui/FileName';
import { NumberField, numberFromText } from '../src/renderer/ui/NumberField';
import { typeAheadIndex, useListKeys } from '../src/renderer/ui/useListKeys';
import { buttonOrder } from '../src/renderer/dialogs/DialogHost';
import { MenuButton, SegmentedControl } from '../src/renderer/ui/ChoiceMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FileName', () => {
  beforeEach(() => {
    // 7 px a character in a 70 px room: ten characters fit
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as unknown as CanvasRenderingContext2D);
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = computed(element);
      return element instanceof HTMLElement && element.classList.contains('file-name-label')
        ? ({
            ...style,
            width: '70px',
            fontSize: '12px',
            fontStyle: 'normal',
            fontWeight: '400',
            fontFamily: 'system-ui',
          } as CSSStyleDeclaration)
        : style;
    });
  });

  it('cuts a long name in its middle, keeps the extension, and names it whole', () => {
    const { container } = render(<FileName name="Quarterly report.xlsx" />);
    const label = container.querySelector<HTMLElement>('.file-name-label')!;
    const shown = label.querySelector('[aria-hidden="true"]')!.textContent!;
    expect(shown).toContain('…');
    expect(shown.endsWith('.xlsx')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(10);
    expect(label.dataset.fileName).toBe('Quarterly report.xlsx');
    expect(label.title).toBe('Quarterly report.xlsx');
    expect(label.querySelector('.visually-hidden')!.textContent).toBe('Quarterly report.xlsx');
  });

  it('shows a name that fits as it is, with no tooltip', () => {
    const { container } = render(<FileName name="a.txt" />);
    const label = container.querySelector<HTMLElement>('.file-name-label')!;
    expect(label.textContent).toBe('a.txt');
    expect(label.hasAttribute('title')).toBe(false);
    expect(label.dataset.fileName).toBe('a.txt');
  });

  it('lets a wrapping list show the whole name', () => {
    const { container } = render(<FileName name="Quarterly report.xlsx" fit="wrap" />);
    expect(container.querySelector('.file-name-label')!.textContent).toBe('Quarterly report.xlsx');
  });
});

describe('NumberField', () => {
  const field = (initial: number, limits: { min?: number; max?: number } = {}) => {
    const commits: number[] = [];
    function Host() {
      const [value, setValue] = useState(initial);
      return (
        <NumberField
          aria-label="Scale"
          value={value}
          {...limits}
          onCommit={(next) => {
            commits.push(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Host />);
    return { input: screen.getByRole('textbox', { name: 'Scale' }) as HTMLInputElement, commits };
  };

  it('takes "50" whole when the minimum is 10, and applies it on Return', () => {
    const { input, commits } = field(100, { min: 10, max: 400 });
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '50' } });
    expect(commits).toEqual([]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(commits).toEqual([50]);
    expect(input.value).toBe('50');
  });

  it('clamps once on blur, goes back on Escape or a non-number, and steps with the arrows', () => {
    const { input, commits } = field(100, { min: 10, max: 400 });
    fireEvent.change(input, { target: { value: '9000' } });
    fireEvent.blur(input);
    expect(commits).toEqual([400]);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('400');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.value).toBe('400');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(commits.at(-1)).toBe(399);
    expect(input.type).toBe('text');
  });

  it('reads decimals and commas only where asked', () => {
    expect(numberFromText('2,5', { kind: 'decimal' })).toBe(2.5);
    expect(numberFromText('2.6', { kind: 'integer' })).toBe(3);
    expect(numberFromText('abc', {})).toBeUndefined();
  });
});

describe('useListKeys', () => {
  it('finds the next row by its first letters, wrapping', () => {
    const labels = ['Alpha', 'Beta', 'Bravo', 'Charlie'];
    expect(typeAheadIndex(labels, 'b', 2)).toBe(2);
    expect(typeAheadIndex(labels, 'b', 3)).toBe(1);
    expect(typeAheadIndex(labels, 'br', 1)).toBe(2);
    expect(typeAheadIndex(labels, 'z', 0)).toBe(-1);
  });

  it('moves, jumps and opens as Finder does', () => {
    const opened: number[] = [];
    const parents: string[] = [];
    function List() {
      const [active, setActive] = useState(0);
      const keyDown = useListKeys({
        labels: ['Alpha', 'Beta', 'Charlie'],
        active,
        select: setActive,
        open: (index) => opened.push(index),
        parent: () => parents.push('up'),
      });
      return createElement('div', {
        role: 'listbox',
        tabIndex: 0,
        'aria-activedescendant': `row-${active}`,
        onKeyDown: keyDown,
      });
    }
    render(<List />);
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list.getAttribute('aria-activedescendant')).toBe('row-1');
    act(() => {
      fireEvent.keyDown(list, { key: 'c' });
    });
    expect(list.getAttribute('aria-activedescendant')).toBe('row-2');
    fireEvent.keyDown(list, { key: 'Enter' });
    fireEvent.keyDown(list, { key: 'ArrowDown', metaKey: true });
    fireEvent.keyDown(list, { key: 'ArrowUp', metaKey: true });
    expect(opened).toEqual([2, 2]);
    expect(parents).toEqual(['up']);
  });
});

describe('message dialog buttons', () => {
  it('puts the default at the right, Cancel beside it and a third choice at the left', () => {
    // asked as Save, Don't Save, Cancel
    expect(
      buttonOrder({ buttons: ['Save', 'Don’t Save', 'Cancel'], defaultId: 0, cancelId: 2 }),
    ).toEqual([1, 2, 0]);
    expect(buttonOrder({ buttons: ['OK'], defaultId: 0, cancelId: 0 })).toEqual([0]);
    expect(buttonOrder({ buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1 })).toEqual([
      0, 1,
    ]);
  });
});

describe('menu buttons and segmented controls', () => {
  it('keeps an action menu button named by its label, its rows unchecked', () => {
    const chosen: string[] = [];
    render(
      <MenuButton
        label="More"
        items={[
          { value: 'copy', label: 'Copy Table' },
          { value: 'save', label: 'Save Copy…' },
        ]}
        onChoose={(value) => chosen.push(value)}
      />,
    );
    const button = screen.getByRole('button', { name: 'More' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(button);
    expect(screen.queryAllByRole('menuitemradio')).toEqual([]);
    fireEvent.click(screen.getByText('Save Copy…'));
    expect(chosen).toEqual(['save']);
    expect(button.textContent).toBe('More');
  });

  it('shows every choice side by side, the current one checked, ← → moving it', () => {
    function Sort() {
      const [value, setValue] = useState('name');
      return (
        <SegmentedControl
          label="Sort"
          value={value}
          choices={[
            { value: 'name', label: 'Name' },
            { value: 'date', label: 'Date' },
          ]}
          onChoose={setValue}
        />
      );
    }
    render(<Sort />);
    const group = screen.getByRole('radiogroup', { name: 'Sort' });
    expect(screen.getByRole('radio', { name: 'Name' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Date' }).getAttribute('aria-checked')).toBe('true');
  });
});
