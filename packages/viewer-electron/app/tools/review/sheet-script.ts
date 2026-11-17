/**
 * The review sheet's script. It is written as a typed function and sent as its source text, as
 * page functions are (tests/native/runtime/page-function.ts), so everything it uses is inside it.
 */
import type { Capture, CheckID, Coverage, Finding, RunResults, SceneResult } from './types';

interface SheetData extends RunResults {
  hasBaseline: boolean;
}

type CaptureMode = 'capture' | 'baseline' | 'difference';
type SceneFilter = 'all' | 'problems' | 'changed';
type Child = Node | string | null | undefined;

export function reviewSheetScript(): void {
  const data = JSON.parse(document.getElementById('review-data')!.textContent!) as SheetData;
  const checkNames: Record<CheckID, string> = {
    wrap: 'Label wraps',
    clipped: 'Clipped',
    'window-overflow': 'Past the window',
    'scroll-overflow': 'Scrolls sideways',
    'dialog-scroll': 'Dialog scrolls sideways',
    'menu-covers-trigger': 'Menu covers its button',
    'home-path': 'Full home path',
    'em-dash': 'Em dash',
    'broken-value': 'Broken value',
    plural: 'One with a plural',
    'name-extension': 'Name loses its extension',
    'layout-shift': 'Layout shift',
  };

  const element = (
    tag: string,
    attributes: Record<string, string | undefined> = {},
    ...children: Child[]
  ): HTMLElement => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) continue;
      if (name === 'text') node.textContent = value;
      else node.setAttribute(name, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  };
  const percent = (value: number) => (value * 100).toFixed(value < 0.01 ? 2 : 1) + '%';
  const open = (capture: Capture) => capture.findings.filter((finding) => !finding.allowed);
  const source = (capture: Capture, mode: CaptureMode) =>
    mode === 'baseline'
      ? capture.baseline!.image!
      : mode === 'difference'
        ? capture.baseline!.difference!
        : capture.image!;

  /** A finding's box over the capture, placed in shares of the window so it scales with it. */
  const outline = (finding: Finding, capture: Capture): HTMLElement | null => {
    const view = capture.viewport;
    if (!finding.box || !view) return null;
    const box = finding.box;
    const node = element('div', { class: 'outline' + (finding.allowed ? ' allowed' : '') });
    node.style.left = (box.x / view.width) * 100 + '%';
    node.style.top = (box.y / view.height) * 100 + '%';
    node.style.width = (box.width / view.width) * 100 + '%';
    node.style.height = (box.height / view.height) * 100 + '%';
    return node;
  };

  const modeButtons = (
    capture: Capture,
    mode: CaptureMode,
    choose: (mode: CaptureMode) => void,
  ): HTMLElement[] => {
    const modes: [CaptureMode, string][] = [['capture', 'This run']];
    if (capture.baseline?.image) modes.push(['baseline', 'Baseline']);
    if (capture.baseline?.difference) modes.push(['difference', 'Difference']);
    if (modes.length === 1) return [];
    return modes.map(([value, label]) => {
      const button = element('button', {
        type: 'button',
        'aria-pressed': String(mode === value),
        text: label,
      });
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        choose(value);
      });
      return button;
    });
  };

  const lightbox = document.getElementById('lightbox')!;
  const lightboxFrame = lightbox.querySelector('.frame')!;
  const lightboxTitle = lightbox.querySelector('.title')!;
  const lightboxModes = lightbox.querySelector('.modes')!;
  const enlarge = (scene: SceneResult, capture: Capture, mode: CaptureMode) => {
    lightboxFrame.replaceChildren(
      element('img', {
        src: source(capture, mode),
        alt: scene.title + ', ' + capture.variant.label,
      }),
    );
    if (mode === 'capture')
      for (const finding of capture.findings) {
        const box = outline(finding, capture);
        if (box) lightboxFrame.append(box);
      }
    lightboxTitle.textContent =
      scene.title + ' · ' + capture.variant.label + (mode === 'capture' ? '' : ' · ' + mode);
    lightboxModes.replaceChildren(
      ...modeButtons(capture, mode, (next) => enlarge(scene, capture, next)),
    );
    lightbox.hidden = false;
  };
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) lightbox.hidden = true;
  });
  lightbox.querySelector('.close')!.addEventListener('click', () => {
    lightbox.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') lightbox.hidden = true;
  });

  const baselineState = (capture: Capture): HTMLElement => {
    if (!capture.baseline)
      return element('span', { class: 'muted', text: data.hasBaseline ? 'New' : '' });
    if (!capture.baseline.sameSize)
      return element('span', { class: 'changed', text: 'Size changed' });
    if (capture.baseline.changed === 0)
      return element('span', { class: 'ok', text: 'Same as baseline' });
    return element('span', {
      class: 'changed',
      text: 'Changed ' + percent(capture.baseline.changed ?? 0),
    });
  };

  const copy = (text: string, button: HTMLElement) => {
    const label = button.textContent;
    const done = () => {
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = label;
      }, 1200);
    };
    // a page opened from disk may not reach the clipboard API; the selection still copies
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };

  const noteKey = (scene: { id: string }) => 'viewer-review:' + data.run + ':' + scene.id;
  // Notes outlive a reload where the browser keeps storage for pages opened from disk; elsewhere
  // they last while the page is open.
  const kept = new Map<string, string>();
  const noteStore = {
    get(key: string): string {
      try {
        return localStorage.getItem(key) ?? kept.get(key) ?? '';
      } catch {
        return kept.get(key) ?? '';
      }
    },
    set(key: string, value: string): void {
      kept.set(key, value);
      try {
        localStorage.setItem(key, value);
      } catch {
        // kept in memory only
      }
    },
  };

  const figure = (scene: SceneResult, capture: Capture): HTMLElement => {
    const image = element('img', {
      src: capture.image,
      alt: scene.title + ', ' + capture.variant.label,
      loading: 'lazy',
    });
    const shot = element('div', { class: 'shot', title: 'Enlarge' }, image);
    const outlines = capture.findings.map((finding) => outline(finding, capture));
    for (const box of outlines) if (box) shot.append(box);
    let mode: CaptureMode = 'capture';
    shot.addEventListener('click', () => enlarge(scene, capture, mode));
    const modes = element('span');
    const choose = (next: CaptureMode) => {
      mode = next;
      image.setAttribute('src', source(capture, next));
      for (const box of outlines) box?.classList.toggle('hidden', next !== 'capture');
      modes.replaceChildren(...modeButtons(capture, mode, choose));
    };
    modes.replaceChildren(...modeButtons(capture, mode, choose));
    const list = element('ul', { class: 'findings' });
    capture.findings.forEach((finding, index) => {
      const item = element(
        'li',
        { class: finding.allowed ? 'allowed' : undefined },
        element('b', { text: checkNames[finding.check] ?? finding.check }),
        ' ' + finding.detail,
        finding.text ? element('div', { text: '“' + finding.text + '”' }) : null,
        element('code', { text: finding.selector }),
        finding.allowed ? element('div', { text: 'Allowed: ' + finding.allowed }) : null,
      );
      item.addEventListener('mouseenter', () => outlines[index]?.classList.add('focus'));
      item.addEventListener('mouseleave', () => outlines[index]?.classList.remove('focus'));
      list.append(item);
    });
    return element(
      'figure',
      {},
      capture.image ? shot : null,
      element(
        'figcaption',
        {},
        element('strong', { text: capture.variant.label }),
        baselineState(capture),
        modes,
        element('span', { class: 'muted', text: (capture.milliseconds / 1000).toFixed(1) + ' s' }),
      ),
      capture.error ? element('div', { class: 'error', text: capture.error }) : null,
      list,
    );
  };

  const noteBox = (scene: SceneResult): HTMLElement => {
    const field = element('textarea', {
      'aria-label': 'Note on ' + scene.title,
      placeholder: 'Note for this scene',
    }) as HTMLTextAreaElement;
    field.value = noteStore.get(noteKey(scene));
    field.addEventListener('input', () => noteStore.set(noteKey(scene), field.value));
    const button = element('button', { type: 'button', text: 'Copy note' });
    button.addEventListener('click', () => copy(scene.id + ': ' + field.value.trim(), button));
    return element('div', { class: 'note' }, field, button);
  };

  const sceneCard = (scene: SceneResult): HTMLElement => {
    const problems = scene.captures.reduce((total, capture) => total + open(capture).length, 0);
    const errors = scene.captures.filter((capture) => capture.error).length;
    const changed = scene.captures.some(
      (capture) =>
        capture.baseline && ((capture.baseline.changed ?? 1) > 0 || !capture.baseline.sameSize),
    );
    return element(
      'section',
      {
        class: 'scene',
        id: 'scene-' + scene.id,
        'data-problems': String(problems + errors + (scene.blocked ? 1 : 0)),
        'data-changed': String(changed),
        'data-search': (scene.id + ' ' + scene.title + ' ' + scene.area).toLowerCase(),
      },
      element(
        'div',
        { class: 'scene-head' },
        element('h3', { text: scene.title }),
        element('code', { text: scene.id }),
        problems
          ? element('span', {
              class: 'count bad',
              text: problems + (problems === 1 ? ' problem' : ' problems'),
            })
          : element('span', { class: 'count', text: 'No problems found' }),
        errors
          ? element('span', {
              class: 'count bad',
              text: errors + (errors === 1 ? ' capture failed' : ' captures failed'),
            })
          : null,
      ),
      scene.blocked
        ? element('div', { class: 'error', text: 'Not captured: ' + scene.blocked })
        : null,
      element(
        'ul',
        { class: 'must' },
        ...scene.mustBeTrue.map((line) => element('li', { text: line })),
      ),
      element(
        'div',
        { class: 'captures' },
        ...scene.captures.map((capture) => figure(scene, capture)),
      ),
      noteBox(scene),
    );
  };

  const main = document.getElementById('scenes')!;
  for (const area of data.areas) {
    const scenes = data.scenes.filter((scene) => scene.area === area.id);
    if (scenes.length)
      main.append(
        element('h2', { id: 'area-' + area.id, text: area.title }),
        ...scenes.map(sceneCard),
      );
  }

  const totals = document.getElementById('totals')!;
  const counts = new Map<CheckID, number>();
  for (const scene of data.scenes)
    for (const capture of scene.captures)
      for (const finding of open(capture))
        counts.set(finding.check, (counts.get(finding.check) ?? 0) + 1);
  const failed = data.scenes.reduce(
    (total, scene) => total + scene.captures.filter((capture) => capture.error).length,
    0,
  );
  for (const [check, count] of [...counts].sort((a, b) => b[1] - a[1]))
    totals.append(element('span', { class: 'count bad', text: checkNames[check] + ': ' + count }));
  if (failed)
    totals.append(element('span', { class: 'count bad', text: 'Failed captures: ' + failed }));
  if (!counts.size && !failed)
    totals.append(element('span', { class: 'count', text: 'No open problems' }));

  let filter: SceneFilter = 'all';
  const search = document.getElementById('search') as HTMLInputElement;
  const applyFilter = () => {
    const query = search.value.trim().toLowerCase();
    for (const card of document.querySelectorAll<HTMLElement>('.scene')) {
      const kept =
        filter === 'all' ||
        (filter === 'problems' && card.dataset.problems !== '0') ||
        (filter === 'changed' && card.dataset.changed === 'true');
      card.classList.toggle('hidden', !kept || (!!query && !card.dataset.search!.includes(query)));
    }
  };
  for (const button of document.querySelectorAll<HTMLElement>('[data-filter]'))
    button.addEventListener('click', () => {
      filter = button.dataset.filter as SceneFilter;
      for (const item of document.querySelectorAll('[data-filter]'))
        item.setAttribute('aria-pressed', String(item === button));
      applyFilter();
    });
  search.addEventListener('input', applyFilter);
  const copyNotes = document.getElementById('copy-notes')!;
  copyNotes.addEventListener('click', () => {
    const notes = data.scenes
      .map((scene) => [scene.id, noteStore.get(noteKey(scene)).trim()])
      .filter(([, note]) => note)
      .map(([id, note]) => id + ': ' + note);
    copy(notes.length ? notes.join('\n') : 'No notes yet.', copyNotes);
  });

  const coverage = document.getElementById('coverage-list')!;
  const groups: [keyof Coverage, string][] = [
    ['commands', 'Commands'],
    ['dialogs', 'Dialogs'],
    ['settings', 'Settings sections'],
    ['previews', 'Preview kinds'],
  ];
  for (const [key, title] of groups) {
    const entries = data.coverage[key];
    const covered = entries.filter((entry) => entry.scenes.length).length;
    const rows = entries.map((entry) =>
      element(
        'tr',
        {},
        element('td', {
          class: 'state ' + (entry.scenes.length ? 'ok' : 'changed'),
          text: entry.scenes.length ? 'Covered' : 'Not covered',
        }),
        element('td', {}, element('code', { text: entry.id })),
        element('td', { text: entry.label }),
        element('td', { class: 'muted', text: entry.scenes.join(', ') }),
      ),
    );
    coverage.append(
      element(
        'details',
        { class: 'coverage' },
        element('summary', { text: title + ': ' + covered + ' of ' + entries.length + ' covered' }),
        element('table', {}, element('tbody', {}, ...rows)),
      ),
    );
  }
}
