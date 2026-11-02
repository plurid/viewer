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
        (selector, requestID, label) => {
          const plane = document.querySelector<HTMLElement>(selector);
          const nativeForm = plane?.querySelector<HTMLFormElement>('.chat-composer');
          const transcript = plane?.querySelector<HTMLElement>('.chat-transcript');
          const paragraph = plane?.querySelector<HTMLElement>(
            `[data-chat-text="${CSS.escape(requestID)}"]`,
          );
          if (!plane || !nativeForm || !transcript || !paragraph || plane.dataset.sessionReplay)
            throw Error('Replay requires the retained message and native chat controls.');
          plane.dataset.sessionReplay = 'composing';
          plane.dataset.replayContext = label;
          const style = document.createElement('style');
          style.dataset.replayStyle = '';
          style.textContent = `
            [data-session-replay] .chat-transcript > :not([data-replay-visible]),
            [data-session-replay] .chat-footer > :not([data-replay-composer]) { display:none; }
            [data-session-replay] .chat-model { opacity:1; }
          `;
          plane.append(style);
          const rememberText = (element: HTMLElement, text: string) => {
            element.dataset.replayOriginalText = element.textContent ?? '';
            element.textContent = text;
          };
          const author = plane.querySelector<HTMLElement>(
            '.chat-message[data-role="assistant"] > strong',
          );
          const model = plane.querySelector<HTMLElement>('.chat-model > span');
          if (model && author) rememberText(model, author.textContent ?? 'Meta');
          for (const item of plane.querySelectorAll<HTMLElement>('.chat-context-items li > span'))
            rememberText(item, (item.textContent ?? '').split('/').filter(Boolean).at(-1) ?? '');

          // Clone native markup so the film uses its styles without reaching the send handler.
          const form = nativeForm.cloneNode(true) as HTMLFormElement;
          form.dataset.replayComposer = '';
          const input = form.querySelector('textarea')!;
          const send = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
          const hint = form.querySelector<HTMLElement>('.chat-composer-hint')!;
          for (const element of form.querySelectorAll('[id]')) element.removeAttribute('id');
          input.removeAttribute('aria-describedby');
          input.disabled = false;
          input.value = '';
          send.disabled = true;
          hint.textContent = 'Command or Control + Enter to send.';
          const submit = () => {
            if (!input.value.trim() || plane.dataset.sessionReplay !== 'composing') return;
            if (input.value !== paragraph.textContent)
              throw Error('Replay request differs from the retained native message.');
            plane.dataset.sessionReplay = 'submitted';
            paragraph.closest<HTMLElement>('.chat-message')!.dataset.replayVisible = '';
            input.value = '';
            send.disabled = true;
            transcript.scrollTop = transcript.scrollHeight;
          };
          form.addEventListener('submit', (event) => {
            event.preventDefault();
            event.stopPropagation();
            submit();
          });
          input.addEventListener('input', () => {
            send.disabled = !input.value.trim();
          });
          input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing)
              return;
            event.preventDefault();
            event.stopPropagation();
            submit();
          });
          nativeForm.parentElement!.append(form);
          transcript.scrollTop = 0;
          input.focus();
        },
        selector,
        request.id,
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
        () => document.querySelector<HTMLTextAreaElement>('[data-replay-composer] textarea')?.value,
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
    mark('session-condensed', { messageID: passage.message.id });
    await main.evaluate(
      pageCall(
        (messageID, text, milliseconds, repairs) => {
          const plane = document.querySelector<HTMLElement>('[data-session-replay]');
          if (plane?.dataset.sessionReplay !== 'submitted')
            throw Error('Replay request was not submitted.');
          const paragraph = plane.querySelector<HTMLElement>(
            `[data-chat-text="${CSS.escape(messageID)}"]`,
          );
          if (!paragraph) throw Error('The retained native reply is unavailable.');
          paragraph.dataset.replayOriginalText = paragraph.textContent ?? '';
          paragraph.textContent = '';
          paragraph.closest<HTMLElement>('.chat-message')!.dataset.replayVisible = '';
          plane.dataset.replayRepairs = String(repairs);
          const transcript = plane.querySelector<HTMLElement>('.chat-transcript')!;
          const words = text.match(/\S+\s*/g) ?? [];
          let index = 0;
          return new Promise<void>((resolve) => {
            const tick = () => {
              paragraph.textContent = words.slice(0, ++index).join('');
              transcript.scrollTop = transcript.scrollHeight;
              if (index >= words.length) {
                paragraph.textContent = text;
                plane.dataset.sessionReplay = 'answered';
                resolve();
              } else setTimeout(tick, milliseconds / Math.max(1, words.length));
            };
            tick();
          });
        },
        passage.message.id,
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
        for (const plane of document.querySelectorAll<HTMLElement>('[data-session-replay]')) {
          for (const element of plane.querySelectorAll<HTMLElement>(
            '[data-replay-original-text]',
          )) {
            element.textContent = element.dataset.replayOriginalText ?? '';
            delete element.dataset.replayOriginalText;
          }
          for (const element of plane.querySelectorAll(
            '[data-replay-composer], [data-replay-style]',
          ))
            element.remove();
          for (const element of plane.querySelectorAll('[data-replay-visible]'))
            element.removeAttribute('data-replay-visible');
          delete plane.dataset.sessionReplay;
          delete plane.dataset.replayContext;
          delete plane.dataset.replayRepairs;
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
        ${selector} .chat-tool, ${selector} .chat-message:not([data-replay-quote]) { display:none; }
        ${selector} .chat-message[data-replay-quote] { margin:24px auto; }
        ${selector} .chat-message[data-replay-quote] p { font-size:18px; line-height:1.6; }
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
