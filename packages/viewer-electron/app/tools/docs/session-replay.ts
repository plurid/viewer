import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pageCall } from '../../tests/native/runtime/page-function';
import type { ChatMessage } from '../../src/domain/models/chat';
import type { Connection } from './record';

export interface ReplayPassage {
  message: ChatMessage;
  start: number;
  end: number;
}

export interface ReplayEvent {
  milliseconds: number;
  kind: string;
  messageID?: string;
  sha256?: string;
  start?: number;
  end?: number;
}

/** Film annotations only. Retained messages, native APIs and generated scripts stay untouched. */
export function sessionReplay(main: Connection) {
  const events: ReplayEvent[] = [];
  const started = performance.now();
  const mark = (kind: string, extra: Omit<ReplayEvent, 'milliseconds' | 'kind'> = {}) =>
    events.push({ milliseconds: performance.now() - started, kind, ...extra });

  async function mount(selector: string, request: ChatMessage, label: string) {
    assert.equal(request.role, 'user');
    mark('request-source', {
      messageID: request.id,
      sha256: createHash('sha256').update(request.text).digest('hex'),
    });
    await main.evaluate(
      pageCall(
        (selector, label) => {
          const plane = document.querySelector<HTMLElement>(selector);
          if (!plane || plane.querySelector('[data-session-replay]'))
            throw Error('Replay needs one visible conversation plane.');
          const host = document.createElement('section');
          host.dataset.sessionReplay = 'composing';
          host.setAttribute('aria-label', 'Edited playback of a saved Meta session');
          host.style.cssText = 'position:absolute;inset:0;z-index:10;background:#31353d';
          const previousPosition = plane.style.position;
          plane.dataset.replayPosition = previousPosition;
          plane.style.position = 'relative';
          host.innerHTML = `<style>
          [data-session-replay] { color:#f2f4f6; font:18px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
          [data-session-replay] * { box-sizing:border-box; }
          [data-session-replay] .replay-bar { height:56px; padding:0 30px; border-bottom:1px solid #454b55; display:flex; align-items:center; justify-content:space-between; gap:20px; font-size:14px; }
          [data-session-replay] .replay-bar span:last-child { color:#b8c2cd; }
          [data-session-replay] .replay-body { max-width:960px; margin:0 auto; padding:40px 44px 30px; }
          [data-session-replay] .replay-context { color:#b8c2cd; font-size:15px; padding-bottom:26px; }
          [data-session-replay] .replay-label { font-size:15px; font-weight:600; margin-bottom:12px; }
          [data-session-replay] textarea { display:block; width:100%; height:210px; resize:none; padding:17px 19px; border:1px solid #697381; border-radius:3px; background:#292d34; color:#f2f4f6; font:inherit; caret-color:#a9cfeb; box-shadow:none; }
          [data-session-replay] textarea:focus { outline:1px solid #9ec4dd; outline-offset:2px; }
          [data-session-replay] .replay-hint { color:#b8c2cd; font-size:14px; padding-top:14px; }
          [data-session-replay] .replay-request { margin:0; white-space:pre-wrap; max-height:185px; overflow:auto; font-size:18px; }
          [data-session-replay] .replay-answer { margin-top:29px; padding-top:25px; border-top:1px solid #454b55; }
          [data-session-replay] .replay-answer p { margin:0; font-size:22px; line-height:1.5; min-height:65px; white-space:pre-wrap; }
          [data-session-replay] .replay-history { margin:22px 0 0; color:#b8c2cd; font-size:14px; }
          [data-session-replay] .replay-open { margin-top:22px; padding:9px 15px; color:#f2f4f6; background:#3c4652; border:1px solid #697381; border-radius:3px; font:500 16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; cursor:pointer; }
          [data-session-replay] ::selection { background:#3a5368; color:white; }
          [data-session-replay] [hidden] { display:none!important; }
          @media (prefers-reduced-motion:reduce) { [data-session-replay] * { scroll-behavior:auto; } }
        </style>
        <div class="replay-bar"><strong>Meta</strong><span>Saved session · edited playback</span></div>
        <div class="replay-body">
          <div class="replay-context"></div>
          <div class="replay-label">You</div>
          <textarea aria-label="Replay the saved request" spellcheck="false"></textarea>
          <div class="replay-hint">Enter to replay the saved response</div>
          <p class="replay-request" hidden></p>
          <div class="replay-answer" hidden><div class="replay-label">Meta</div><p></p></div>
          <p class="replay-history" hidden>Saved session condensed, including repair rounds. Full messages retained.</p>
          <button class="replay-open" type="button" hidden>Open canvas</button>
        </div>`;
          host.querySelector('.replay-context')!.textContent = label;
          const input = host.querySelector('textarea')!;
          input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            event.stopPropagation();
            host.dataset.sessionReplay = 'submitted';
            const request = host.querySelector<HTMLElement>('.replay-request')!;
            request.textContent = input.value;
            request.hidden = false;
            input.hidden = true;
            host.querySelector<HTMLElement>('.replay-hint')!.hidden = true;
          });
          host.querySelector('.replay-open')!.addEventListener('click', () => {
            const native = [
              ...plane.querySelectorAll<HTMLButtonElement>('.chat-toolbar button'),
            ].find((button) => button.textContent?.trim() === 'Canvas');
            if (!native) throw Error('Native Canvas action is unavailable.');
            native.click();
          });
          plane.append(host);
          input.focus();
        },
        selector,
        label,
      ),
    );
  }

  async function type(request: ChatMessage, milliseconds = 7200) {
    const chunks = request.text.match(/.{1,6}/gs) ?? [];
    for (const text of chunks) {
      await main.command('Input.insertText', { text });
      await delay(milliseconds / Math.max(1, chunks.length));
    }
    const value = await main.evaluate(
      pageCall(
        () => document.querySelector<HTMLTextAreaElement>('[data-session-replay] textarea')?.value,
      ),
    );
    assert.equal(value, request.text, 'Replay must type the retained request exactly.');
    mark('request-typed', { messageID: request.id });
  }

  async function answer(passage: ReplayPassage, milliseconds = 2600, repairs = true) {
    assert.equal(passage.message.role, 'assistant');
    assert.ok(
      passage.start >= 0 &&
        passage.end > passage.start &&
        passage.end <= passage.message.text.length,
    );
    const text = passage.message.text.slice(passage.start, passage.end);
    mark('reply-excerpt', {
      messageID: passage.message.id,
      start: passage.start,
      end: passage.end,
      sha256: createHash('sha256').update(passage.message.text).digest('hex'),
    });
    await main.evaluate(
      pageCall(
        (text, milliseconds, repairs) => {
          const host = document.querySelector<HTMLElement>('[data-session-replay]');
          if (host?.dataset.sessionReplay !== 'submitted')
            throw Error('Replay request was not submitted.');
          const section = host.querySelector<HTMLElement>('.replay-answer')!;
          const paragraph = section.querySelector('p')!;
          section.hidden = false;
          host.querySelector<HTMLElement>('.replay-history')!.hidden = !repairs;
          const words = text.match(/\S+\s*/g) ?? [];
          let index = 0;
          return new Promise<void>((resolve) => {
            const tick = () => {
              paragraph.textContent = words.slice(0, ++index).join('');
              if (index >= words.length) {
                paragraph.textContent = text;
                host.dataset.sessionReplay = 'answered';
                host.querySelector<HTMLButtonElement>('.replay-open')!.hidden = false;
                resolve();
              } else setTimeout(tick, milliseconds / Math.max(1, words.length));
            };
            tick();
          });
        },
        text,
        milliseconds,
        repairs,
      ),
    );
    mark('reply-visible', { messageID: passage.message.id });
  }

  async function dismiss() {
    await main.evaluate(
      pageCall(() => {
        const host = document.querySelector('[data-session-replay]');
        const plane = host?.parentElement;
        host?.remove();
        if (plane) {
          plane.style.position = plane.dataset.replayPosition ?? '';
          delete plane.dataset.replayPosition;
        }
      }),
    );
    mark('native-controls-restored');
  }

  async function focusQuote(selector: string, messageID: string) {
    await main.evaluate(
      pageCall(
        (selector, messageID) => {
          const plane = document.querySelector<HTMLElement>(selector)!;
          const message = plane.querySelector(`[data-chat-text="${CSS.escape(messageID)}"]`);
          if (!message) throw Error('The retained quoted message is unavailable.');
          message.closest('article')!.setAttribute('data-replay-quote', 'true');
          const style = document.createElement('style');
          style.textContent = `
        ${selector} .chat-toolbar, ${selector} .chat-context, ${selector} .chat-footer { display:none; }
        ${selector} .chat-transcript { padding:40px 44px; }
        ${selector} .chat-tool, ${selector} .chat-message:not([data-replay-quote]) { display:none; }
        ${selector} .chat-message[data-replay-quote] { max-width:900px; margin:60px auto 0; }
        ${selector} .chat-message[data-replay-quote] > strong { font-size:16px; }
        ${selector} .chat-message[data-replay-quote] p { font-size:20px; line-height:1.6; }
        ${selector} .chat-quote-action { font-size:16px; padding:10px 15px; }
        ${selector} .chat-message[data-replay-quote]::before { content:'Saved Meta reply · select a passage to explore separately'; display:block; font-size:15px; color:#b8c2cd; margin-bottom:28px; }
      `;
          plane.append(style);
          plane.querySelector('.chat-transcript')!.scrollTop = 0;
        },
        selector,
        messageID,
      ),
    );
    mark('native-quote-focused', { messageID });
  }

  async function coverCanvas() {
    await main.evaluate(
      pageCall(() => {
        if (document.querySelector('#capture-canvas-cover'))
          throw Error('Canvas cover already mounted.');
        const style = document.createElement('style');
        style.id = 'capture-canvas-cover';
        style.textContent = '.canvas-plane iframe { opacity:0!important; }';
        document.head.append(style);
      }),
    );
    mark('canvas-covered');
  }

  async function revealCanvas(
    frame: Pick<Connection, 'evaluate'>,
    mode: 'create' | 'refine' | 'branch',
  ) {
    await frame.evaluate(
      pageCall((mode) => {
        const stage = document.querySelector<HTMLElement>('.presentation-stage');
        const panel = document.querySelector<HTMLElement>('.panel');
        if (!stage || !panel) throw Error('The qualified presentation layout is required.');
        stage.style.opacity = mode === 'create' ? '0' : '1';
        panel.style.opacity = '0';
        panel.style.pointerEvents = 'none';
      }, mode),
    );
    await main.evaluate(pageCall(() => document.querySelector('#capture-canvas-cover')?.remove()));
    await delay(450);
    mark('canvas-reveal-start');
    await frame.evaluate(
      pageCall(async (mode) => {
        const stage = document.querySelector<HTMLElement>('.presentation-stage')!;
        const panel = document.querySelector<HTMLElement>('.panel')!;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (mode === 'create') {
          stage.style.opacity = '1';
          await stage.animate(
            reduced
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
            { duration: reduced ? 160 : 650, easing: 'cubic-bezier(.16,1,.3,1)' },
          ).finished;
        }
        await new Promise((resolve) => setTimeout(resolve, 650));
        panel.style.opacity = '1';
        await panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 120 : 450 })
          .finished;
        panel.style.pointerEvents = '';
        stage.style.opacity = '';
        panel.style.opacity = '';
      }, mode),
    );
    mark('canvas-reveal-complete');
  }

  return { events, mount, type, answer, dismiss, focusQuote, coverCanvas, revealCanvas };
}
