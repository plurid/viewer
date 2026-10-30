// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MailPreview from '../src/renderer/previews/modules/MailPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { DocumentData } from '../src/domain/services';
import type { MailMessage } from '../src/domain/previews/mail/message';
import type { DocumentRequest } from '../src/domain/previews/documents/requests';

afterEach(cleanup);

const capability = (sequence: number) =>
  `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
const mail = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  subject: 'Field trip',
  from: 'Ana Ionescu <ana@example.invalid>',
  to: 'Field team <team@example.invalid>',
  cc: 'Ștefan Popa <stefan@example.invalid>',
  date: 'Fri, 06 Mar 2026 18:42:00 +0200',
  time: Date.parse('2026-03-06T16:42:00Z'),
  text: 'Hello team,\nWe meet at 08:30.',
  html: true,
  attachments: [{ name: 'Packing list.txt', type: 'text/plain', size: 2048 }],
  limited: false,
  ...overrides,
});
const data = (fields: Partial<DocumentData>): DocumentData => ({
  path: '/fixtures/Trip.eml',
  metadata: {},
  evidence: [],
  text: '',
  truncated: false,
  ...fields,
});

function context(extension: string, document: (request?: DocumentRequest) => DocumentData) {
  let sequence = 0;
  const values = new Map<string, unknown>();
  const services = {
    document: vi.fn(async (_id: string, request?: DocumentRequest) => document(request)),
    cancelDocument: vi.fn(async () => {}),
    htmlPreview: vi.fn(async () => {
      const id = capability(++sequence);
      return { id, url: `viewer-html://${id}/page.html`, blocked: 2 };
    }),
    htmlPreviewClose: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const value = {
    resource: { id: 'resource', url: '', entry: { name: `Trip.${extension}`, extension } },
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, next: unknown) => values.set(key, next),
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services,
  } as unknown as PreviewContext;
  return { context: value, services };
}

describe('email preview', () => {
  it('shows the header, attachments and the HTML body in a script-free sandbox', async () => {
    const { context: preview, services } = context('eml', () => data({ mail: mail() }));
    const { container } = render(<MailPreview {...preview} />);
    expect(await screen.findByRole('heading', { name: 'Field trip' })).toBeTruthy();
    for (const text of [
      'Ana Ionescu <ana@example.invalid>',
      'Field team <team@example.invalid>',
      'Ștefan Popa <stefan@example.invalid>',
      'Packing list.txt',
    ])
      expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText(/text\/plain · 2 KB/)).toBeTruthy();
    const frame = await waitFor(() => {
      const element = container.querySelector('iframe');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toBe(`viewer-html://${capability(1)}/page.html`);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(services.htmlPreview).toHaveBeenCalledWith('resource');
    expect(screen.getByRole('status').textContent).toBe('Remote images are blocked.');
  });

  it('switches to the plain text form and back', async () => {
    const { context: preview, services } = context('eml', () => data({ mail: mail() }));
    const { container } = render(<MailPreview {...preview} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Plain text' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe('Hello team,\nWe meet at 08:30.');
    await waitFor(() => expect(services.htmlPreviewClose).toHaveBeenCalledWith(capability(1)));
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  });

  it('shows a plain message as text without opening a page', async () => {
    const { context: preview, services } = context('emlx', () =>
      data({ mail: mail({ html: false, attachments: [], cc: '', subject: '' }) }),
    );
    const { container } = render(<MailPreview {...preview} />);
    expect(await screen.findByRole('heading', { name: 'No subject' })).toBeTruthy();
    expect(container.querySelector('pre')?.textContent).toContain('We meet at 08:30.');
    expect(screen.queryByText('Cc')).toBeNull();
    expect(screen.queryByLabelText('Attachments')).toBeNull();
    expect(services.htmlPreview).not.toHaveBeenCalled();
  });

  it('says when the message cannot be read', async () => {
    const { context: preview } = context('eml', () => {
      throw new Error('The message headers exceed the reader limit.');
    });
    render(<MailPreview {...preview} />);
    expect(await screen.findByText('This email could not be read')).toBeTruthy();
    expect(screen.getByText('The message headers exceed the reader limit.')).toBeTruthy();
  });
});

describe('mailbox preview', () => {
  const rows = ['First', 'Second', 'Third'].map((subject, index) => ({
    subject,
    from: `Sender ${index + 1}`,
    date: `Mon, 0${index + 2} Mar 2026 09:00:00 +0000`,
    time: Date.parse(`2026-03-0${index + 2}T09:00:00Z`),
    size: 100,
  }));
  const mailbox = (request?: DocumentRequest) =>
    request && 'message' in request
      ? data({
          mail: mail({ subject: rows[request.message]!.subject, html: request.message === 1 }),
        })
      : data({ mailbox: { messages: rows, truncated: true } });

  it('lists the messages and opens the chosen one in the message view', async () => {
    const { context: preview, services } = context('mbox', mailbox);
    const { container } = render(<MailPreview {...preview} />);
    const list = await screen.findByRole('list', { name: 'Messages' });
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    expect(within(list).getByText('Sender 2')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'First' })).toBeTruthy();
    expect(services.document).toHaveBeenLastCalledWith(
      'resource',
      expect.objectContaining({ message: 0 }),
    );
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(within(list).getByText('Second'));
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeTruthy();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(services.htmlPreview).toHaveBeenCalledWith('resource', 1);
    expect(screen.getByText('The first 10,000 messages are listed.')).toBeTruthy();
  });

  it('moves between messages with the arrow keys', async () => {
    const { context: preview } = context('mbox', mailbox);
    render(<MailPreview {...preview} />);
    const list = await screen.findByRole('list', { name: 'Messages' });
    expect(await screen.findByRole('heading', { name: 'First' })).toBeTruthy();
    fireEvent.keyDown(list, { key: 'End' });
    expect(await screen.findByRole('heading', { name: 'Third' })).toBeTruthy();
    expect(within(list).getAllByRole('button')[2]!.getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeTruthy();
  });

  it('says a file with no messages is an empty mailbox', async () => {
    const { context: preview } = context('mbox', () =>
      data({ mailbox: { messages: [], truncated: false } }),
    );
    render(<MailPreview {...preview} />);
    expect(await screen.findByText('This mailbox has no messages')).toBeTruthy();
  });
});
