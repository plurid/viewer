import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { containsPath } from '../../src/desktop/files/containment';
import { parseRobotURDF } from '../../src/domain/robotics/urdf';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import type { ChatDocument, ChatRequest } from '../../src/domain/models/chat';

export const robotStages = ['create', 'refine', 'branch'] as const;
export type RobotStage = (typeof robotStages)[number];
export const robotStageSchema = z.enum(robotStages);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const robotRepairSchema = z
  .object({
    canvasID: z.uuid(),
    revision: z.number().int().nonnegative(),
    htmlHash: hashSchema,
    message: z.string().trim().min(1).max(1000),
  })
  .strict();
export type RobotRepair = z.infer<typeof robotRepairSchema>;
const relativePath = z
  .string()
  .refine(
    (file) =>
      file.length > 0 &&
      !file.includes('\\') &&
      !file.includes('\0') &&
      !path.posix.isAbsolute(file) &&
      file.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Expected a relative file path without traversal.',
  );
const manifestSchema = z
  .object({
    repository: z.literal('https://github.com/TheRobotStudio/SO-ARM100'),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    files: z
      .array(
        z
          .object({
            path: relativePath,
            sha256: hashSchema,
            bytes: z
              .number()
              .int()
              .positive()
              .max(32 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
const fixture = (file: string) => new URL('../../tests/fixtures/robotics/' + file, import.meta.url);
export const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export const fingerprint = (value: unknown) => digest(JSON.stringify({ value }));
export async function saveEvidence(file: string, value: unknown) {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function readEvidence(file: string | URL, maximum = 8 * 1024 * 1024): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum)
      throw new Error('Evidence must be a bounded regular file.');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('Evidence changed while reading.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.size !== bytes.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('Evidence changed while reading.');
    return bytes;
  } finally {
    await handle.close();
  }
}
export const readJSON = async (file: string | URL): Promise<unknown> =>
  JSON.parse((await readEvidence(file)).toString('utf8'));

async function specification() {
  const manifest = manifestSchema.parse(await readJSON(fixture('so101/manifest.json')));
  const placement = await readJSON(fixture('base-placement.json'));
  const task = Buffer.from(
    JSON.stringify(
      {
        purpose: 'Compare two base placements against the same fixed world targets.',
        units: { length: 'm', angle: 'rad' },
        tool: { link: 'gripper_frame_link', point: [0, 0, 0] },
        tolerance: 0.001,
        placement,
        scope:
          'Endpoint positions and hard joint limits only. No orientation, collision, interval or hardware checks.',
      },
      null,
      2,
    ) + '\n',
  );
  return { manifest, task };
}

export const rehearsalPrompts: Record<RobotStage, string> = {
  create:
    'Build an interactive tool from the attached SO-101 robot folder. Use the new-calibration follower URDF and its actual visual meshes. Let me orbit the arm, move each joint with a labelled control, see its declared limit and open its source definition. Keep the arm large and the controls readable. Persist my joint positions and camera. Explain the calibration caveat. Do not add target solving yet.',
  refine:
    'Keep my joint and camera inputs. Read task.json and add editable world-coordinate targets A and B, base placement controls, and position solving for the stated tool and tolerance. Start with the original base. Save the task and candidate poses under robotTask and provide a Check poses button using Viewer’s independent checker. Show an unresolved search honestly. Add play, pause and scrubbing for visual pose replay without changing the saved checked poses. Explain what is and is not checked.',
  branch:
    'Explore the alternative base placement in task.json in this quoted branch. Keep the original canvas unchanged and preserve the same world targets, target order, tool, units and tolerance. Keep an explicit base control so I can apply the alternative without silently overwriting preserved inputs. Solve for new candidate joint poses, retain the independent Check poses action and visual replay. Explain how to compare both checked placements in Viewer. Do not claim success before reading its measured result.',
};

/** Copy only pinned public inputs. Preparing a run never reads credentials or uses the network. */
export async function prepareRobotRehearsal(corpusPath: string, root: string) {
  const corpus = await realpath(corpusPath);
  const project = path.join(root, 'SO-101');
  const { manifest, task } = await specification();
  await mkdir(project, { mode: 0o700 });
  for (const file of manifest.files) {
    const source = path.join(corpus, file.path);
    if (!containsPath(corpus, await realpath(source)))
      throw new Error('A pinned file leaves the corpus.');
    const bytes = await readEvidence(source, file.bytes);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new Error('Pinned corpus mismatch: ' + file.path);
    const destination = path.join(project, file.path);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
  }
  await writeFile(path.join(project, 'task.json'), task, { flag: 'wx', mode: 0o600 });
  await mkdir(path.join(root, 'Profile'), { mode: 0o700 });
  await mkdir(path.join(root, 'sessions'), { mode: 0o700 });
  const plan = {
    version: 1,
    kind: 'robot-rehearsal',
    manifest,
    taskHash: digest(task),
    prompts: rehearsalPrompts,
    authorization: 'No model calls authorized by preparation. A fresh user budget is required.',
  };
  await saveEvidence(path.join(root, 'plan.json'), plan);
  await verifyRobotRehearsal(root);
  return plan;
}

/** Recheck the allowlist before a paid attempt, including unexpected directory entries. */
export async function verifyRobotRehearsal(root: string) {
  if ((await realpath(root)) !== root) throw new Error('Use the canonical rehearsal folder.');
  for (const name of ['SO-101', 'Profile', 'sessions']) {
    const directory = path.join(root, name);
    if ((await realpath(directory)) !== directory)
      throw new Error('The rehearsal contains a linked directory.');
  }
  const { manifest, task } = await specification();
  const expectedPlan = {
    version: 1,
    kind: 'robot-rehearsal',
    manifest,
    taskHash: digest(task),
    prompts: rehearsalPrompts,
    authorization: 'No model calls authorized by preparation. A fresh user budget is required.',
  };
  if (fingerprint(await readJSON(path.join(root, 'plan.json'))) !== fingerprint(expectedPlan))
    throw new Error('The rehearsal plan changed. Prepare and review a new run.');
  const project = await realpath(path.join(root, 'SO-101'));
  const files = [
    ...manifest.files,
    { path: 'task.json', sha256: digest(task), bytes: task.length },
  ];
  const allowed = new Set(files.map((file) => path.join(project, file.path)));
  const directories = new Set([project]);
  for (const file of allowed) {
    let parent = path.dirname(file);
    while (containsPath(project, parent)) {
      directories.add(parent);
      if (parent === project) break;
      parent = path.dirname(parent);
    }
  }
  for (const directory of directories) {
    if ((await realpath(directory)) !== directory)
      throw new Error('The project contains a linked directory.');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (
        entry.isSymbolicLink() ||
        !(entry.isDirectory() ? directories.has(file) : entry.isFile() && allowed.has(file))
      )
        throw new Error('An unreviewed entry was added to the public project.');
    }
  }
  for (const file of files) {
    const bytes = await readEvidence(path.join(project, file.path), file.bytes);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new Error('The public input changed: ' + file.path);
  }
  const urdf = path.join(project, 'Simulation/SO101/so101_new_calib.urdf');
  const robot = parseRobotURDF((await readEvidence(urdf)).toString('utf8'));
  return { project, urdf, files, directories, allowed, robot };
}

export function reviewToken(conversation: ChatDocument, canvas: CanvasDocument): string {
  return fingerprint({ conversation, canvas });
}
export function requireReview(
  token: string | undefined,
  conversation: ChatDocument,
  canvas: CanvasDocument,
) {
  if (!token || token !== reviewToken(conversation, canvas))
    throw new Error(
      'Review this exact saved conversation and canvas in Viewer before the next stage.',
    );
}
/** The operator supplies an exact selection from a real attributed assistant response. */
export function robotBranchRequest(
  document: ChatDocument,
  messageID: string,
  start: number,
  end: number,
): Extract<ChatRequest, { kind: 'branch' }> {
  const message = document.messages.find((item) => item.id === messageID);
  if (
    !message ||
    message.role !== 'assistant' ||
    !message.provider ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > message.text.length ||
    end - start > 16000 ||
    !message.text.slice(start, end).trim()
  )
    throw new Error('Select an exact nonempty passage from an actual attributed assistant reply.');
  return { kind: 'branch', id: document.id, revision: document.revision, messageID, start, end };
}

const budgetSchema = z
  .object({
    sessions: z.number().int().min(1).max(8),
    requestsPerSession: z.number().int().min(1).max(8),
  })
  .strict();
export type RobotBudget = z.infer<typeof budgetSchema>;

/** Exclusive records reserve budget before work; failures and interruptions never refund it. */
export class RobotRehearsalLedger {
  constructor(readonly root: string) {}
  async authorize(budget: RobotBudget) {
    const checked = budgetSchema.parse(budget);
    const file = path.join(this.root, 'budget.json');
    try {
      await saveEvidence(file, checked);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (fingerprint(budgetSchema.parse(await readJSON(file))) !== fingerprint(checked))
        throw new Error('The saved budget cannot be extended by restarting the runner.');
    }
  }
  async sessions() {
    const names = (await readdir(path.join(this.root, 'sessions'))).sort();
    if (names.some((name) => !/^\d{2}$/.test(name)))
      throw new Error('Unexpected rehearsal session entry.');
    if (names.some((name, index) => Number(name) !== index + 1))
      throw new Error('The session ledger is incomplete.');
    return names.map((name) => path.join(this.root, 'sessions', name));
  }
  async begin(stage: RobotStage, metadata: unknown) {
    robotStageSchema.parse(stage);
    const budget = budgetSchema.parse(await readJSON(path.join(this.root, 'budget.json')));
    const previous = await this.sessions();
    for (const session of previous) {
      // An absent or malformed result is an interrupted attempt, not another free attempt.
      const result = await readJSON(path.join(session, 'result.json'));
      if (
        !result ||
        typeof result !== 'object' ||
        !('status' in result) ||
        !['generated', 'failed', 'stopped'].includes(String(result.status))
      )
        throw new Error('Inspect the interrupted session before proceeding.');
    }
    if (previous.length >= budget.sessions)
      throw new Error('The approved session budget is exhausted.');
    const folder = path.join(this.root, 'sessions', String(previous.length + 1).padStart(2, '0'));
    await mkdir(folder, { mode: 0o700 });
    await saveEvidence(path.join(folder, 'started.json'), { stage, at: Date.now(), metadata });
    return new RobotRehearsalSession(folder, budget.requestsPerSession);
  }
}

export class RobotRehearsalSession {
  private next = 0;
  constructor(
    readonly folder: string,
    private limit: number,
  ) {}
  async reserveRequest(input: unknown) {
    if (this.next >= this.limit)
      throw new Error('The approved request budget for this session is exhausted.');
    const number = ++this.next;
    const prefix = path.join(this.folder, `request-${String(number).padStart(2, '0')}`);
    await saveEvidence(prefix + '.json', { at: Date.now(), input });
    return prefix;
  }
  finish(result: unknown) {
    return saveEvidence(path.join(this.folder, 'result.json'), result);
  }
}
