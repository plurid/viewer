import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chats } from '../src/desktop/chat';
import { defaultSettings, type ModelProvider } from '../src/domain/services';
import type { ChatDocument, ChatReply, ChatStep } from '../src/domain/chat';
import type { CapturedTarget } from '../src/domain/automation';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const provider: ModelProvider = {
  id: 'test',
  name: 'Test model',
  kind: 'openai',
  endpoint: 'https://example.invalid/v1',
  model: 'test',
  allowContent: true,
};
const step = (kind: ChatStep['kind'], extra: Partial<ChatStep> = {}): ChatStep => ({
  kind,
  text: '',
  path: null,
  query: null,
  commandID: null,
  patches: [],
  renames: [],
  ...extra,
});
const document = (reply: ChatReply): ChatDocument => {
  if (Array.isArray(reply)) throw new Error('Expected a document.');
  return reply;
};
let root: string;
let chat: Chats;
let origin: {
  target: CapturedTarget;
  commands: { id: string; label: string; group: string; aliases: string[] }[];
};
let ports: ConstructorParameters<typeof Chats>[1];
const generate = vi.fn();
const inspect = vi.fn();
const command = vi.fn();
const rename = vi.fn();
const configuration = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  root = await temporaryRoot('viewer-chat-');
  await mkdir(path.join(root, 'context'));
  await mkdir(path.join(root, 'private'));
  await writeFile(path.join(root, 'context', 'notes.txt'), 'Original content');
  const settings = { ...defaultSettings(root), providers: [provider] };
  origin = {
    target: {
      workspaceID: 'w',
      paneID: 'p',
      rootID: 'p',
      directory: path.join(root, 'context'),
      selection: [],
    },
    commands: [{ id: 'hidden', label: 'Show hidden', group: 'View', aliases: [] }],
  };
  ports = {
    settings: () => settings,
    access: async () => {},
    generate,
    inspect,
    permit: async (_provider, signal, work) => work(signal),
    command,
    rename,
    configuration,
    valid: () => true,
    changed: () => {},
    aliases: () => new Map(),
  };
  chat = new Chats(path.join(root, 'private'), ports);
});
afterEach(async () => {
  await chat.close();
  await trashTemporary(root);
});

async function create(): Promise<ChatDocument> {
  return document(
    await chat.request({ kind: 'create', paths: [path.join(root, 'context')] }, 1, origin),
  );
}
async function settled(id: string): Promise<ChatDocument> {
  let current: ChatDocument | undefined;
  await vi.waitFor(async () => {
    current = document(await chat.request({ kind: 'open', id }, 1, origin));
    expect(current.status).not.toBe('running');
  });
  return current!;
}
async function send(id: string): Promise<void> {
  await chat.request({ kind: 'send', id, text: 'Inspect these files', providerID: provider.id }, 1);
}

describe('read-only Chat', () => {
  it('bounds an inspection loop and reports a damaged conversation without hiding intact ones', async () => {
    const conversation = await create();
    generate.mockResolvedValue(step('metadata', { path: path.join(root, 'context', 'notes.txt') }));
    await send(conversation.id);
    const result = await settled(conversation.id);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('eight-step limit');
    expect(generate).toHaveBeenCalledTimes(8);
    const broken = '590d87b9-8b81-4d53-9d67-546e3a638c2f';
    await writeFile(path.join(root, 'private', 'chat-documents', broken + '.json'), '{broken');
    const summaries = await chat.request({ kind: 'list' }, 1);
    expect(Array.isArray(summaries)).toBe(true);
    if (!Array.isArray(summaries)) throw new Error('Expected conversation summaries.');
    expect(summaries.find((item) => item.id === conversation.id)?.problem).toBeUndefined();
    expect(summaries.find((item) => item.id === broken)?.problem).toBeTruthy();
  });
  it('rejects escaping symlinks before inspecting their contents', async () => {
    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, 'Never sent');
    const link = path.join(root, 'context', 'escape.txt');
    await symlink(outside, link);
    generate.mockResolvedValue(step('read', { path: link }));
    const conversation = await create();
    await send(conversation.id);
    const result = await settled(conversation.id);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('outside');
    expect(inspect).not.toHaveBeenCalled();
    expect(result.messages.some((message) => message.text.includes('Never sent'))).toBe(false);
  });

  it('requires excerpt permission before reading and keeps the stopped transcript after reopening', async () => {
    const conversation = await create();
    ports.permit = async () => {
      throw new Error('Excerpts need approval');
    };
    generate.mockResolvedValue(step('read', { path: path.join(root, 'context', 'notes.txt') }));
    await send(conversation.id);
    const result = await settled(conversation.id);
    expect(result).toMatchObject({
      status: 'failed',
      level: 'excerpts',
      error: 'Excerpts need approval',
    });
    expect(inspect).not.toHaveBeenCalled();
    await chat.close();
    chat = new Chats(path.join(root, 'private'), ports);
    const recovered = document(
      await chat.request({ kind: 'open', id: conversation.id }, 2, origin),
    );
    expect(recovered.messages).toEqual(result.messages);
    expect(recovered.status).toBe('failed');
  });

  it('creates a rename review without writing files or applying the review', async () => {
    const file = path.join(root, 'context', 'notes.txt');
    rename.mockResolvedValue({ id: '10a21b40-72b2-46d4-85ad-d76cfba84d7a' });
    generate
      .mockResolvedValueOnce(
        step('rename', { renames: [{ path: file, name: 'Clearer.txt' }], text: 'Suggested name' }),
      )
      .mockResolvedValue(step('reply', { text: 'The rename is ready for your review.' }));
    const conversation = await create();
    await send(conversation.id);
    const result = await settled(conversation.id);
    expect(result.status).toBe('idle');
    expect(rename).toHaveBeenCalledOnce();
    expect(rename.mock.calls[0]![1][0]).toMatchObject({
      kind: 'rename',
      sources: [await realpath(file)],
      name: 'Clearer.txt',
    });
    expect(await readFile(file, 'utf8')).toBe('Original content');
    expect(result.messages.some((message) => message.proposal?.kind === 'operation')).toBe(true);
    expect(command).not.toHaveBeenCalled();
    expect(configuration).not.toHaveBeenCalled();
  });

  it('preserves a draft written while the provider is answering', async () => {
    let finish!: (value: ChatStep) => void;
    generate.mockImplementation(
      () =>
        new Promise<ChatStep>((resolve) => {
          finish = resolve;
        }),
    );
    const conversation = await create();
    await send(conversation.id);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await chat.request(
      { kind: 'draft', id: conversation.id, text: 'The next question', revision: 1 },
      1,
    );
    finish(step('reply', { text: 'Answer' }));
    const result = await settled(conversation.id);
    expect(result.draft).toBe('The next question');
    expect(result.messages.at(-1)?.text).toBe('Answer');
    await expect(
      chat.request(
        { kind: 'send', id: conversation.id, text: 'Other window', providerID: provider.id },
        2,
      ),
    ).rejects.toThrow('another window');
  });
});
