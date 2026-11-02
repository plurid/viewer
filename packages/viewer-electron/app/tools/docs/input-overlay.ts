import { pageCall } from '../../tests/native/runtime/page-function';
import type { Connection } from './record';

type Input = {
  milliseconds: number;
  type: string;
  key?: string;
  modifiers?: number;
  x?: number;
  y?: number;
  clickCount?: number;
  characters?: number;
};

/** Capture annotations follow dispatched inputs; they never invoke application actions. */
export async function inputOverlay(source: Connection) {
  const events: Input[] = [];
  let started = performance.now();
  let label = '';
  let position = { x: 130, y: 100 };
  await source.evaluate(
    pageCall(() => {
      if (document.querySelector('#capture-inputs')) throw Error('Input overlay already installed');
      const host = document.createElement('div');
      host.id = 'capture-inputs';
      host.setAttribute('aria-hidden', 'true');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { position:fixed; inset:0; pointer-events:none; z-index:2147483647; }
          .pointer { position:absolute; top:0; left:0; width:22px; height:28px;
            filter:drop-shadow(0 2px 2px #0008); }
          .ring { position:absolute; top:-17px; left:-17px; width:34px; height:34px;
            border:1.5px solid #f2f4f6; border-radius:50%; opacity:0; }
          .readout { position:absolute; bottom:26px; left:50%; transform:translateX(-50%);
            display:flex; align-items:center; gap:15px; padding:10px 16px 10px 10px;
            max-width:calc(100% - 64px); white-space:nowrap; border:1px solid #626b78;
            border-radius:6px; background:#20242b; color:#f2f4f6;
            font:500 16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            opacity:0; transition:opacity 160ms ease-out; }
          .readout[data-visible=true] { opacity:1; }
          .keys { display:flex; align-items:center; gap:5px; }
          kbd { display:grid; place-items:center; box-sizing:border-box; min-width:38px;
            height:38px; padding:0 10px; border:1px solid #697381; border-bottom-width:3px;
            border-radius:4px; background:#343b45; color:#fff;
            font:500 23px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
          kbd.word { font-size:14px; }
          .action:empty { display:none; }
          @media (prefers-reduced-motion:reduce) { .readout { transition:none; } }
        </style>
        <div class="pointer"><div class="ring"></div>
          <svg viewBox="0 0 22 28"><path d="M2 2v21l5.7-5 4.7 8 3.6-2-4.7-8H20Z"
            fill="white" stroke="#13171c" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </div>
        <div class="readout"><div class="keys"></div><div class="action"></div></div>`;
      document.body.append(host);
    }),
  );

  let hide: ReturnType<typeof setTimeout> | undefined;
  async function show(keys: string[]) {
    if (hide) clearTimeout(hide);
    await source.evaluate(
      pageCall(
        (keys, label) => {
          const root = document.querySelector('#capture-inputs')!.shadowRoot!;
          const group = root.querySelector('.keys')!;
          group.replaceChildren(
            ...keys.map((key) => {
              const cap = document.createElement('kbd');
              cap.textContent = key;
              if (key.length > 2) cap.className = 'word';
              return cap;
            }),
          );
          root.querySelector('.action')!.textContent = label;
          root.querySelector<HTMLElement>('.readout')!.dataset.visible = 'true';
        },
        keys,
        label,
      ),
    );
  }
  function release() {
    if (hide) clearTimeout(hide);
    hide = setTimeout(() => {
      void source
        .evaluate(
          pageCall(() => {
            const root = document.querySelector('#capture-inputs')?.shadowRoot;
            const readout = root?.querySelector<HTMLElement>('.readout');
            if (readout) readout.dataset.visible = 'false';
          }),
        )
        .catch(() => undefined);
    }, 1650);
  }
  function modifiers(value: number) {
    return [
      ...(value & 2 ? ['⌃'] : []),
      ...(value & 1 ? ['⌥'] : []),
      ...(value & 8 ? ['⇧'] : []),
      ...(value & 4 ? ['⌘'] : []),
    ];
  }
  const connection: Connection = {
    ...source,
    async command<T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ) {
      if (method.startsWith('Input.')) {
        const event: Input = {
          milliseconds: performance.now() - started,
          type: String(params.type ?? method),
        };
        for (const field of ['modifiers', 'x', 'y', 'clickCount'] as const)
          if (typeof params[field] === 'number') event[field] = params[field];
        if (method === 'Input.insertText') event.characters = String(params.text ?? '').length;
        if (method === 'Input.dispatchKeyEvent') {
          const key = String(params.key ?? '');
          const mods = Number(params.modifiers ?? 0);
          const special: Record<string, string> = {
            Enter: '↵',
            Escape: 'esc',
            ArrowUp: '↑',
            ArrowDown: '↓',
            ArrowLeft: '←',
            ArrowRight: '→',
            Tab: '⇥',
            Backspace: '⌫',
            ' ': 'space',
          };
          // Ordinary text may include private paths or credentials. Never display or retain it.
          if (mods || special[key]) {
            event.key = key;
            if (params.type === 'keyDown')
              await show([...modifiers(mods), special[key] ?? key.toUpperCase()]);
          }
          if (params.type === 'keyUp') release();
        }
        if (method === 'Input.dispatchMouseEvent' && typeof params.x === 'number') {
          position = { x: params.x, y: Number(params.y) };
          await source.evaluate(
            pageCall(
              (x, y, pressed) => {
                const root = document.querySelector('#capture-inputs')!.shadowRoot!;
                root.querySelector<HTMLElement>('.pointer')!.style.transform =
                  `translate(${x}px,${y}px)`;
                if (pressed) {
                  const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
                  const ring = root.querySelector('.ring')!;
                  ring.getAnimations().forEach((animation) => animation.cancel());
                  ring.animate(
                    [
                      { opacity: 0.8, transform: `scale(${reduced ? 1 : 0.7})` },
                      { opacity: 0, transform: `scale(${reduced ? 1 : 1.15})` },
                    ],
                    { duration: 340, easing: 'ease-out' },
                  );
                }
              },
              params.x,
              Number(params.y),
              params.type === 'mousePressed',
            ),
          );
          if (params.type === 'mousePressed' && (params.modifiers || label)) {
            await show([
              ...modifiers(Number(params.modifiers ?? 0)),
              Number(params.clickCount) === 2 ? 'Double-click' : 'Click',
            ]);
          } else if (params.type === 'mouseReleased') release();
        }
        events.push(event);
      }
      return source.command<T>(method, params, sessionId);
    },
  };
  return {
    connection,
    events,
    position: () => position,
    cue(action: string) {
      label = action;
    },
    reset() {
      events.length = 0;
      started = performance.now();
    },
    dispose() {
      if (hide) clearTimeout(hide);
    },
  };
}
