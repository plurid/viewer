import { constants } from 'node:fs';
import { open, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { remoteHost } from '../../domain/remote/connections';
import { remoteLimits } from '../../domain/remote/limits';
import { containsPath } from '../files/containment';
import { fileStat, lstat } from '../files/stats';
import { itemIdentity, sameIdentity } from '../../domain/files/item-identity';

/** ssh_config words: whitespace or `=` separate them, quotes group them. */
function words(line: string): string[] {
  const tokens = line.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s=]+/g) ?? [];
  return tokens.map((token) => token.replace(/^(["'])(.*)\1$/, '$2'));
}

function globExpression(part: string): RegExp {
  const escaped = part
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp('^' + escaped + '$');
}

/**
 * Host names for the Connect dialog's suggestions, read only after the person's yes. It follows
 * Include inside `~/.ssh` (four levels, 1 MiB in all) and never applies a directive: OpenSSH
 * reads its configuration itself when it connects.
 */
export async function readSSHConfigHosts(
  sshDirectory = path.join(os.homedir(), '.ssh'),
): Promise<string[]> {
  let root: string;
  try {
    root = await realpath(sshDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error('The SSH configuration could not be read.');
  }
  let bytes = 0;
  let entries = 0;
  const visited = new Set<string>();
  const hosts = new Set<string>();

  /** OpenSSH reads a relative Include in `~/.ssh`; `~/.ssh/...` names the same folder. */
  const located = (pattern: string): string => {
    if (!pattern.startsWith('~/')) {
      return path.resolve(root, pattern);
    }
    const absolute = path.resolve(os.homedir(), pattern.slice(2));
    return containsPath(sshDirectory, absolute)
      ? path.join(root, path.relative(sshDirectory, absolute))
      : absolute;
  };

  const expand = async (pattern: string): Promise<string[]> => {
    const absolute = located(pattern);
    if (!containsPath(root, absolute)) {
      return [];
    }
    if (!/[*?[]/.test(absolute)) {
      return [absolute];
    }
    const parts = path.relative(root, absolute).split(path.sep);
    if (parts.length > remoteLimits.sshConfigDepth + 1) {
      return [];
    }
    let folders = [root];
    for (const part of parts) {
      const next: string[] = [];
      const expression = globExpression(part);
      for (const folder of folders) {
        let children;
        try {
          children = await readdir(folder, { withFileTypes: true });
        } catch {
          continue;
        }
        entries += children.length;
        if (entries > remoteLimits.sshConfigEntries) {
          throw new Error('The SSH configuration has too many include entries.');
        }
        for (const child of children) {
          if (!child.isSymbolicLink() && expression.test(child.name)) {
            next.push(path.join(folder, child.name));
          }
        }
      }
      folders = next;
    }
    return folders.toSorted();
  };

  /** One configuration file, opened without following links and checked to be the same file. */
  const text = async (actual: string): Promise<string | undefined> => {
    const handle = await open(
      actual,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await fileStat(handle);
      if (!before.isFile()) {
        return undefined;
      }
      const current = await lstat(actual);
      if (
        !containsPath(root, await realpath(actual)) ||
        !sameIdentity(itemIdentity(current), itemIdentity(before))
      ) {
        throw new Error('The SSH configuration changed while opening.');
      }
      if (bytes + before.size > remoteLimits.sshConfigBytes) {
        throw new Error('The SSH configuration exceeds 1 MiB.');
      }
      bytes += before.size;
      const content = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < content.length) {
        const result = await handle.read(content, offset, content.length - offset, offset);
        if (!result.bytesRead) {
          throw new Error('The SSH configuration changed while reading.');
        }
        offset += result.bytesRead;
      }
      const after = await fileStat(handle);
      if (after.size !== before.size || after.ctimeMs !== before.ctimeMs) {
        throw new Error('The SSH configuration changed while reading.');
      }
      return content.toString('utf8');
    } finally {
      await handle.close();
    }
  };

  const read = async (file: string, depth: number): Promise<void> => {
    if (depth > remoteLimits.sshConfigDepth || visited.has(file)) {
      return;
    }
    let actual: string;
    try {
      if ((await lstat(file)).isSymbolicLink()) {
        return;
      }
      actual = await realpath(file);
    } catch {
      return;
    }
    if (!containsPath(root, actual) || visited.has(actual)) {
      return;
    }
    visited.add(actual);
    const content = await text(actual);
    if (content === undefined) {
      return;
    }
    // A Match block's Include depends on conditions only OpenSSH can evaluate.
    let match = false;
    for (const line of content.split(/\r?\n/)) {
      const [directive, ...values] = words(line.replace(/(?:^|\s)#.*$/, ''));
      const key = directive?.toLowerCase();
      if (key === 'match') {
        match = true;
      } else if (key === 'host') {
        match = false;
        for (const host of values) {
          if (!/[*?!]/.test(host) && remoteHost.safeParse(host).success) {
            hosts.add(host);
          }
        }
      } else if (key === 'include' && !match) {
        for (const include of values) {
          for (const child of await expand(include)) {
            await read(child, depth + 1);
          }
        }
      }
    }
  };

  await read(path.join(root, 'config'), 0);
  return [...hosts].toSorted();
}
