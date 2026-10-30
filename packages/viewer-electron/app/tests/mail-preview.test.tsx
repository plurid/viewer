// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MailPreview from '../src/renderer/previews/modules/MailPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { DocumentData } from '../src/domain/services';
import type { MailMessage } from '../src/domain/previews/mail/message';
import type { DocumentRequest } from '../src/domain/previews/documents/requests';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import { saveAttachments } from '../src/renderer/previews/attachments';

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

  it('saves an attachment beside the message or to a folder chosen, and all of them at once', async () => {
    const attachments = [
      { name: 'Packing list.txt', type: 'text/plain', size: 2048 },
      { name: 'Ridge.png', type: 'image/png', size: 90_000 },
    ];
    const { context: preview } = context('eml', () => data({ mail: mail({ attachments }) }));
    const saveAttachments = vi.fn(async () => {});
    render(<MailPreview {...preview} saveAttachments={saveAttachments} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save Ridge.png' }));
    expect(saveAttachments).toHaveBeenLastCalledWith({
      message: undefined,
      attachments: [{ part: 1, name: 'Ridge.png' }],
      destination: 'beside',
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Packing list.txt to…' })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Packing list.txt to…' }));
    expect(saveAttachments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attachments: [{ part: 0, name: 'Packing list.txt' }],
        destination: 'choose',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save All' })).toHaveProperty('disabled', false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save All' }));
    expect(saveAttachments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attachments: [
          { part: 0, name: 'Packing list.txt' },
          { part: 1, name: 'Ridge.png' },
        ],
        destination: 'beside',
      }),
    );
  });

  it('offers no saving where the host cannot save, and no Save All for one attachment', async () => {
    const { context: preview } = context('eml', () => data({ mail: mail() }));
    const { rerender } = render(<MailPreview {...preview} />);
    expect(await screen.findByText('Packing list.txt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    rerender(<MailPreview {...preview} saveAttachments={vi.fn(async () => {})} />);
    expect(screen.getByRole('button', { name: 'Save Packing list.txt' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save All' })).toBeNull();
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

  it("saves an attachment of the chosen message by the message's place in the mailbox", async () => {
    const { context: preview } = context('mbox', mailbox);
    const saveAttachments = vi.fn(async () => {});
    render(<MailPreview {...preview} saveAttachments={saveAttachments} />);
    const list = await screen.findByRole('list', { name: 'Messages' });
    fireEvent.click(within(list).getByText('Third'));
    expect(await screen.findByRole('heading', { name: 'Third' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Packing list.txt' }));
    expect(saveAttachments).toHaveBeenCalledWith({
      message: 2,
      attachments: [{ part: 0, name: 'Packing list.txt' }],
      destination: 'beside',
    });
  });

  it('says a file with no messages is an empty mailbox', async () => {
    const { context: preview } = context('mbox', () =>
      data({ mailbox: { messages: [], truncated: false } }),
    );
    render(<MailPreview {...preview} />);
    expect(await screen.findByText('This mailbox has no messages')).toBeTruthy();
  });
});

describe('saving attachments from the preview host', () => {
  const message: FileEntry = {
    path: '/fixtures/Mail/Trip.eml',
    name: 'Trip.eml',
    parent: '/fixtures/Mail',
    extension: 'eml',
    mime: 'message/rfc822',
    size: 4096,
    kind: 'file',
    directory: false,
    identity: '1:42',
    modified: 1700,
    created: 1,
    hidden: false,
  };
  function viewer(chosen: string | null) {
    const api = {
      operate: vi.fn<ViewerAPI['operate']>(async () => crypto.randomUUID()),
      chooseFolder: vi.fn<ViewerAPI['chooseFolder']>(async () => chosen),
    };
    Object.assign(window, { viewer: api });
    return api;
  }

  it('saves each beside its message, by its safe name, pinned to the version read', async () => {
    const api = viewer(null);
    await saveAttachments(message, {
      attachments: [
        { part: 0, name: '.profile' },
        { part: 3, name: 'Q1/Q2.csv' },
      ],
      destination: 'beside',
    });
    expect(api.chooseFolder).not.toHaveBeenCalled();
    expect(api.operate.mock.calls.map(([request]) => request)).toEqual(
      [
        ['profile', 0],
        ['Q1-Q2.csv', 3],
      ].map(([name, part]) => ({
        kind: 'convert',
        sources: [message.path],
        destination: '/fixtures/Mail',
        name,
        transform: { kind: 'mail-attachment', part },
        expectedSources: [
          { path: message.path, version: { identity: '1:42', modified: 1700, size: 4096 } },
        ],
      })),
    );
  });

  it('asks for a folder for Save to…, and saves nothing when the person cancels', async () => {
    const chosen = viewer('/fixtures/Chosen');
    const request = {
      message: 4,
      attachments: [{ part: 1, name: 'Route.txt' }],
      destination: 'choose' as const,
    };
    await saveAttachments(message, request);
    expect(chosen.chooseFolder).toHaveBeenCalledWith('/fixtures/Mail');
    expect(chosen.operate).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: '/fixtures/Chosen',
        transform: { kind: 'mail-attachment', message: 4, part: 1 },
      }),
    );
    const cancelled = viewer(null);
    await saveAttachments(message, request);
    expect(cancelled.operate).not.toHaveBeenCalled();
  });
});
