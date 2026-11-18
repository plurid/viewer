/**
 * The review sheet's script. It is written as a typed function and sent as its source text, as
 * page functions are (tests/native/runtime/page-function.ts), so everything it uses is inside it.
 */
import type {
  Capture,
  CheckID,
  Coverage,
  Finding,
  RunResults,
  SceneResult,
  Variant,
} from './types';

interface SheetData extends RunResults {
  hasBaseline: boolean;
}

type CaptureMode = 'capture' | 'baseline' | 'difference';
type SceneFilter = 'all' | 'problems' | 'changed';
type Mark = '' | 'pass' | 'fail';
type Child = Node | string | null | undefined;

/** One finding where it was seen. */
interface Seen {
  capture: Capture;
  finding: Finding;
}

/** One distinct problem of a scene: a check on a kind of element, in one or more variants. */
interface Problem {
  check: CheckID;
  detail: string;
  allowed?: string;
  seen: Seen[];
}

export function reviewSheetScript(): void {
  const data = JSON.parse(document.getElementById('review-data')!.textContent!) as SheetData;
  const checkNames: Record<CheckID, string> = {
    wrap: 'Label wraps',
    clipped: 'Clipped',
    'window-overflow': 'Past the window',
    'scroll-overflow': 'Scrolls sideways',
    'dialog-scroll': 'Dialog scrolls sideways',
    'menu-covers-trigger': 'Menu covers its button',
    'menu-search': 'Search on a short list',
    'home-path': 'Full home path',
    'em-dash': 'Em dash',
    'broken-value': 'Broken value',
    plural: 'One with a plural',
    'name-extension': 'Name loses its extension',
    'layout-shift': 'Layout shift',
    measure: 'Wrong size or place',
    wording: 'Wording',
  };
  /** What several elements sharing a problem are called: "4 file names". */
  const nouns: Record<CheckID, string> = {
    wrap: 'controls',
    clipped: 'elements',
    'window-overflow': 'elements',
    'scroll-overflow': 'containers',
    'dialog-scroll': 'containers',
    'menu-covers-trigger': 'menus',
    'menu-search': 'menus',
    'home-path': 'paths',
    'em-dash': 'texts',
    'broken-value': 'texts',
    plural: 'texts',
    'name-extension': 'file names',
    'layout-shift': 'parts',
    measure: 'elements',
    wording: 'texts',
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
  const source = (capture: Capture, mode: CaptureMode) =>
    mode === 'baseline'
      ? capture.baseline!.image!
      : mode === 'difference'
        ? capture.baseline!.difference!
        : capture.image!;
  const variantKey = (variant: Variant) => JSON.stringify(variant.data);

  // Notes and the hand marks on must-be-true lines outlive a reload where the browser keeps
  // storage for pages opened from disk; elsewhere they last while the page is open.
  const kept = new Map<string, string>();
  const store = {
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
  const noteKey = (scene: { id: string }) => 'viewer-review:' + data.run + ':' + scene.id;
  const markKey = (scene: { id: string }, line: number) => noteKey(scene) + ':must:' + line;

  /**
   * A scene's findings as distinct problems: the same check on the same kind of element, with
   * what varies (a file name, a number, which row is selected) set aside, is one problem.
   */
  const problemsOf = (scene: SceneResult): Problem[] => {
    const problems = new Map<string, Problem>();
    for (const capture of scene.captures)
      for (const finding of capture.findings) {
        const selector = finding.selector
          .replace(/\.is-[a-z-]+/g, '')
          .replace(/\[aria-label="[^"]*"\]/g, '[aria-label]');
        const detail = finding.detail.replace(/\.[A-Za-z0-9]{1,8}\b/g, '.ext').replace(/\d+/g, 'N');
        const key = finding.check + '|' + selector + '|' + detail + '|' + (finding.allowed ?? '');
        const problem = problems.get(key) ?? {
          check: finding.check,
          detail: finding.detail,
          allowed: finding.allowed,
          seen: [],
        };
        problem.seen.push({ capture, finding });
        problems.set(key, problem);
      }
    return [...problems.values()].sort(
      (a, b) => Number(!!a.allowed) - Number(!!b.allowed) || b.seen.length - a.seen.length,
    );
  };
  const openProblems = (scene: SceneResult) => problemsOf(scene).filter((item) => !item.allowed);

  /** A finding's box over a capture, placed in shares of the window so it scales with it. */
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
  /** The outlines drawn for each finding, so a problem's line can light them all. */
  const outlines = new Map<Finding, HTMLElement>();

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

  // The enlarged view shows the capture's true pixels and scrolls when it is larger.
  const lightbox = document.getElementById('lightbox')!;
  const lightboxFrame = lightbox.querySelector('.frame')!;
  const lightboxTitle = lightbox.querySelector('.title')!;
  const lightboxModes = lightbox.querySelector('.modes')!;
  const enlarge = (scene: SceneResult, capture: Capture, mode: CaptureMode) => {
    const image = element('img', {
      src: source(capture, mode),
      alt: scene.title + ', ' + capture.variant.label,
    });
    lightboxFrame.replaceChildren(image);
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
    if (event.target === lightbox || event.target === lightboxFrame.parentElement)
      lightbox.hidden = true;
  });
  lightbox.querySelector('.close')!.addEventListener('click', () => {
    lightbox.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') lightbox.hidden = true;
  });

  const baselineState = (capture: Capture): HTMLElement | null => {
    if (!capture.baseline)
      return data.hasBaseline ? element('span', { class: 'muted', text: 'New' }) : null;
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

  const figure = (scene: SceneResult, capture: Capture): HTMLElement => {
    const parts: Child[] = [];
    if (capture.image) {
      const image = element('img', {
        src: capture.image,
        alt: scene.title + ', ' + capture.variant.label,
        loading: 'lazy',
      });
      const shot = element('div', { class: 'shot', title: 'Enlarge' }, image);
      const drawn: HTMLElement[] = [];
      for (const finding of capture.findings) {
        const box = outline(finding, capture);
        if (!box) continue;
        outlines.set(finding, box);
        drawn.push(box);
        shot.append(box);
      }
      let mode: CaptureMode = 'capture';
      shot.addEventListener('click', () => enlarge(scene, capture, mode));
      const modes = element('span', { class: 'modes' });
      const choose = (next: CaptureMode) => {
        mode = next;
        image.setAttribute('src', source(capture, next));
        for (const box of drawn) box.classList.toggle('hidden', next !== 'capture');
        modes.replaceChildren(...modeButtons(capture, mode, choose));
      };
      modes.replaceChildren(...modeButtons(capture, mode, choose));
      parts.push(shot, modes);
    }
    return element(
      'figure',
      {},
      ...parts,
      element(
        'figcaption',
        {},
        element('strong', { text: capture.variant.label }),
        baselineState(capture),
        element('span', { class: 'muted', text: (capture.milliseconds / 1000).toFixed(1) + ' s' }),
      ),
      capture.error ? element('div', { class: 'error', text: capture.error }) : null,
    );
  };

  /** The variants a problem was seen in: "all 4", or each one. */
  const variantChips = (scene: SceneResult, problem: Problem): HTMLElement[] => {
    const labels = [...new Set(problem.seen.map((item) => item.capture.variant.label))];
    const captured = scene.captures.filter((capture) => capture.image).length;
    if (labels.length === captured && captured > 1)
      return [element('span', { class: 'chip', text: 'all ' + captured })];
    return labels.map((label) => element('span', { class: 'chip', text: label }));
  };

  const problemLine = (scene: SceneResult, problem: Problem): HTMLElement => {
    // how many elements share it: the most seen in any one capture
    const perCapture = new Map<Capture, number>();
    for (const item of problem.seen)
      perCapture.set(item.capture, (perCapture.get(item.capture) ?? 0) + 1);
    const elements = Math.max(...perCapture.values());
    const items = problem.seen.map((item) =>
      element(
        'li',
        {},
        element('span', { class: 'chip', text: item.capture.variant.label }),
        ' ' + item.finding.detail,
        item.finding.text ? element('div', { text: '“' + item.finding.text + '”' }) : null,
        element('code', { text: item.finding.selector }),
      ),
    );
    const line = element(
      'li',
      { class: 'problem' + (problem.allowed ? ' allowed' : '') },
      element(
        'div',
        { class: 'problem-head' },
        element('b', { text: checkNames[problem.check] ?? problem.check }),
        // several names share one line: the line says what they share
        element('span', {
          text:
            elements > 1
              ? problem.detail.replace(
                  /so \.[A-Za-z0-9]+ does not show/,
                  'so their extensions do not show',
                )
              : problem.detail,
        }),
        elements > 1
          ? element('span', {
              class: 'chip count',
              text: elements + ' ' + nouns[problem.check],
            })
          : null,
        ...variantChips(scene, problem),
      ),
      problem.allowed
        ? element('div', { class: 'muted', text: 'Allowed: ' + problem.allowed })
        : null,
      element(
        'details',
        {},
        element('summary', { text: 'Elements and text' }),
        element('ul', { class: 'elements' }, ...items),
      ),
    );
    const light = (on: boolean) => {
      for (const item of problem.seen) outlines.get(item.finding)?.classList.toggle('focus', on);
    };
    line.addEventListener('mouseenter', () => light(true));
    line.addEventListener('mouseleave', () => light(false));
    return line;
  };

  const markLabels: Record<Mark, string> = { '': 'Not checked', pass: 'Pass', fail: 'Fail' };
  const nextMark: Record<Mark, Mark> = { '': 'pass', pass: 'fail', fail: '' };
  const mustLines = (scene: SceneResult): HTMLElement =>
    element(
      'ul',
      { class: 'must' },
      ...scene.mustBeTrue.map((text, index) => {
        let mark = store.get(markKey(scene, index)) as Mark;
        const button = element('button', {
          type: 'button',
          class: 'mark',
          'data-mark': mark,
          text: markLabels[mark],
          'aria-label': 'Mark: ' + text,
        });
        button.addEventListener('click', () => {
          mark = nextMark[mark];
          store.set(markKey(scene, index), mark);
          button.dataset.mark = mark;
          button.textContent = markLabels[mark];
        });
        return element('li', {}, button, element('span', { text }));
      }),
    );

  const noteBox = (scene: SceneResult): HTMLElement => {
    const field = element('textarea', {
      'aria-label': 'Note on ' + scene.title,
      placeholder: 'Note for this scene',
    }) as HTMLTextAreaElement;
    field.value = store.get(noteKey(scene));
    field.addEventListener('input', () => store.set(noteKey(scene), field.value));
    const button = element('button', { type: 'button', text: 'Copy note' });
    button.addEventListener('click', () => copy(sceneNotes(scene) || scene.id + ':', button));
    return element('div', { class: 'note' }, field, button);
  };

  /** A scene's note and marked lines, as text to paste into a chat. */
  const sceneNotes = (scene: SceneResult): string => {
    const lines: string[] = [];
    const note = store.get(noteKey(scene)).trim();
    if (note) lines.push(scene.id + ': ' + note);
    scene.mustBeTrue.forEach((text, index) => {
      const mark = store.get(markKey(scene, index));
      if (mark) lines.push(scene.id + ' ' + mark + ': ' + text);
    });
    return lines.join('\n');
  };

  const sceneCard = (scene: SceneResult): HTMLElement => {
    const problems = problemsOf(scene);
    const open = problems.filter((item) => !item.allowed);
    const errors = scene.captures.filter((capture) => capture.error).length;
    const changed = scene.captures.some(
      (capture) =>
        capture.baseline && ((capture.baseline.changed ?? 1) > 0 || !capture.baseline.sameSize),
    );
    // one row per scene choice, such as short and long names, each with its sizes and looks
    const rows = new Map<string, Capture[]>();
    for (const capture of scene.captures.filter((item) => !item.newerBuild))
      rows.set(variantKey(capture.variant), [
        ...(rows.get(variantKey(capture.variant)) ?? []),
        capture,
      ]);
    const notice = scene.blocked
      ? 'Not captured: ' + scene.blocked
      : scene.newerBuild
        ? 'Needs a newer build: ' + scene.newerBuild
        : undefined;
    return element(
      'section',
      {
        class: 'scene',
        id: 'scene-' + scene.id,
        'data-area': scene.area,
        'data-checks': [...new Set(open.map((item) => item.check))].join(' '),
        'data-problems': String(open.length + errors + (notice ? 1 : 0)),
        'data-changed': String(changed),
        'data-search': (scene.id + ' ' + scene.title + ' ' + scene.area).toLowerCase(),
      },
      element(
        'div',
        { class: 'scene-head' },
        element('h3', { text: scene.title }),
        element('code', { text: scene.id }),
        open.length
          ? element('span', {
              class: 'count bad',
              text: open.length + (open.length === 1 ? ' problem' : ' problems'),
            })
          : notice
            ? null
            : element('span', { class: 'count', text: 'No problems found' }),
        errors
          ? element('span', {
              class: 'count bad',
              text: errors + (errors === 1 ? ' capture failed' : ' captures failed'),
            })
          : null,
      ),
      notice ? element('div', { class: scene.blocked ? 'error' : 'pending', text: notice }) : null,
      mustLines(scene),
      ...[...rows.entries()].map(([key, captures]) =>
        element(
          'div',
          { class: 'captures' },
          key === '{}'
            ? null
            : element('div', {
                class: 'row-label',
                text: Object.values(JSON.parse(key)).join(', '),
              }),
          ...captures.map((capture) => figure(scene, capture)),
        ),
      ),
      problems.length
        ? element(
            'ul',
            { class: 'problems' },
            ...problems.map((problem) => problemLine(scene, problem)),
          )
        : null,
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

  // Filters: by state, by text, and by an area and check from the summary table.
  let filter: SceneFilter = 'all';
  let picked: { area: string; check?: string } | undefined;
  const search = document.getElementById('search') as HTMLInputElement;
  const applyFilter = () => {
    const query = search.value.trim().toLowerCase();
    for (const card of document.querySelectorAll<HTMLElement>('.scene')) {
      const kept =
        (filter === 'all' ||
          (filter === 'problems' && card.dataset.problems !== '0') ||
          (filter === 'changed' && card.dataset.changed === 'true')) &&
        (!query || card.dataset.search!.includes(query)) &&
        (!picked ||
          (card.dataset.area === picked.area &&
            (!picked.check || card.dataset.checks!.split(' ').includes(picked.check))));
      card.classList.toggle('hidden', !kept);
    }
    document.getElementById('picked')!.textContent = picked
      ? 'Showing ' +
        data.areas.find((area) => area.id === picked!.area)!.title +
        (picked.check ? ', ' + checkNames[picked.check as CheckID] : '')
      : '';
    document.getElementById('clear-pick')!.hidden = !picked;
  };
  for (const button of document.querySelectorAll<HTMLElement>('[data-filter]'))
    button.addEventListener('click', () => {
      filter = button.dataset.filter as SceneFilter;
      for (const item of document.querySelectorAll('[data-filter]'))
        item.setAttribute('aria-pressed', String(item === button));
      applyFilter();
    });
  search.addEventListener('input', applyFilter);
  document.getElementById('clear-pick')!.addEventListener('click', () => {
    picked = undefined;
    applyFilter();
  });

  // The summary: areas down, checks across, distinct problems in each cell.
  const counts = new Map<string, number>();
  const checks = new Set<CheckID>();
  for (const scene of data.scenes)
    for (const problem of openProblems(scene)) {
      checks.add(problem.check);
      const key = scene.area + '|' + problem.check;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const columns = (Object.keys(checkNames) as CheckID[]).filter((check) => checks.has(check));
  const pick = (area: string, check?: string) => {
    picked = { area, check };
    filter = 'all';
    for (const item of document.querySelectorAll('[data-filter]'))
      item.setAttribute('aria-pressed', String((item as HTMLElement).dataset.filter === 'all'));
    applyFilter();
    document.getElementById('area-' + area)?.scrollIntoView?.();
  };
  const cell = (area: string, check: CheckID) => {
    const count = counts.get(area + '|' + check) ?? 0;
    if (!count) return element('td', { class: 'muted', text: '' });
    const link = element('a', { href: '#area-' + area, text: String(count) });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      pick(area, check);
    });
    return element('td', { class: 'bad' }, link);
  };
  const summary = document.getElementById('summary')!;
  summary.append(
    element(
      'table',
      {},
      element(
        'thead',
        {},
        element(
          'tr',
          {},
          element('th', { text: 'Area' }),
          ...columns.map((check) => element('th', { text: checkNames[check] })),
          element('th', { text: 'Not captured' }),
        ),
      ),
      element(
        'tbody',
        {},
        ...data.areas
          .filter((area) => data.scenes.some((scene) => scene.area === area.id))
          .map((area) => {
            const name = element('a', { href: '#area-' + area.id, text: area.title });
            name.addEventListener('click', (event) => {
              event.preventDefault();
              pick(area.id);
            });
            const waiting = data.scenes.filter(
              (scene) =>
                scene.area === area.id &&
                (scene.blocked ||
                  scene.newerBuild ||
                  scene.captures.some((capture) => capture.error)),
            ).length;
            return element(
              'tr',
              {},
              element('th', {}, name),
              ...columns.map((check) => cell(area.id, check)),
              element('td', {
                class: waiting ? 'bad' : 'muted',
                text: waiting ? String(waiting) : '',
              }),
            );
          }),
      ),
    ),
  );

  const copyNotes = document.getElementById('copy-notes')!;
  copyNotes.addEventListener('click', () => {
    const notes = data.scenes.map(sceneNotes).filter(Boolean);
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
