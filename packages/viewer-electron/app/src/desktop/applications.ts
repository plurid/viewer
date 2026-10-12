import { execFile, spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { absolute } from './filesystem';
import type { ApplicationChoices, NativeApplication } from '../domain/metadata';
const exec = promisify(execFile);
const choicesSchema = z.object({
  applications: z
    .array(
      z.object({ path: z.string().max(32768), name: z.string().max(500), default: z.boolean() }),
    )
    .max(128),
  defaultName: z.string().max(500).nullish(),
});
export async function readApplications(
  helper: string,
  paths: string[],
  flags: string[] = [],
): Promise<unknown> {
  const input = JSON.stringify(paths);
  if (Buffer.byteLength(input) > 1024 * 1024)
    throw new Error('Choose a smaller selection to list compatible applications.');
  return new Promise((resolve, reject) => {
    const child = spawn(helper, flags, { stdio: ['pipe', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Application discovery timed out. Try Choose Application.'));
    }, 15000);
    let output = '';
    let error = '';
    child.stdout.on('data', (value) => {
      output += String(value);
      if (output.length > 1024 * 1024) {
        child.kill();
        reject(new Error('Application discovery returned too much information.'));
      }
    });
    child.stderr.on('data', (value) => {
      if (error.length < 4000) error += String(value);
    });
    child.stdin.on('error', () => {});
    child.on('error', (value) => {
      clearTimeout(timeout);
      reject(value);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(error || 'Compatible applications could not be listed.'));
      else {
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error('Application discovery returned invalid information.'));
        }
      }
    });
    child.stdin.end(input);
  });
}

/** Opaque IDs refer only to apps discovered by the OS or selected in a native picker. */
export class Applications {
  private registered = new Map<string, { application: NativeApplication; path: string }>();
  constructor(
    private helper: string,
    private adapter = {
      list: readApplications,
      open: async (app: string, files: string[]) => {
        await exec('/usr/bin/open', ['-a', app, '--', ...files]);
      },
    },
  ) {}
  async register(file: string, name?: string, isDefault = false): Promise<NativeApplication> {
    const app = await realpath(absolute(file));
    if (path.extname(app).toLowerCase() !== '.app' || !(await lstat(app)).isDirectory())
      throw new Error('Choose a macOS application bundle.');
    for (const record of this.registered.values()) {
      if (record.path === app) return { ...record.application, default: isDefault };
    }
    const application = {
      id: randomUUID(),
      name: name || path.basename(app, path.extname(app)),
      default: isDefault,
    };
    this.registered.set(application.id, { application, path: app });
    if (this.registered.size > 512) this.registered.delete(this.registered.keys().next().value!);
    return application;
  }
  async list(paths: string[]): Promise<ApplicationChoices> {
    if (process.platform !== 'darwin') return { applications: [], supported: false };
    const value = choicesSchema.parse(await this.adapter.list(this.helper, paths.map(absolute)));
    const applications: NativeApplication[] = [];
    for (const app of value.applications) {
      try {
        applications.push(await this.register(app.path, app.name, app.default));
      } catch {
        /* Ignore applications removed during discovery. */
      }
    }
    return { applications, supported: true, defaultName: value.defaultName || undefined };
  }
  async open(paths: string[], id: string): Promise<void> {
    const record = this.registered.get(id);
    if (!record)
      throw new Error('Choose the application again; this choice is no longer available.');
    const app = await realpath(record.path);
    if (app !== record.path || !(await lstat(app)).isDirectory())
      throw new Error('The selected application is no longer available.');
    const files = paths.map(absolute);
    for (const file of files) await lstat(file);
    // execFile passes literal arguments; filenames are never interpreted as shell code.
    for (let offset = 0; offset < files.length; offset += 64)
      await this.adapter.open(app, files.slice(offset, offset + 64));
  }
}
