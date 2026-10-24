import { z } from 'zod';

export const launchRequestSchema = z
  .object({
    paths: z.array(z.string().min(1).max(32768)).max(100),
    newWindow: z.boolean(),
    terminal: z.boolean(),
    workspace: z.string().min(1).max(200).optional(),
  })
  .strict();

export type LaunchRequest = z.infer<typeof launchRequestSchema>;

/** Parse argv once, preserving literal filenames and the invoking process's working directory. */
export function parseLaunch(
  argv: readonly string[],
  cwd: string,
  home: string,
  resolve: (directory: string, file: string) => string,
): LaunchRequest {
  const request: LaunchRequest = { paths: [], newWindow: false, terminal: false };
  let literal = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (!literal && argument === '--') {
      literal = true;
      continue;
    }
    if (!literal && argument === '--new-window') {
      request.newWindow = true;
      continue;
    }
    if (!literal && argument === '--terminal') {
      request.terminal = true;
      continue;
    }
    if (!literal && argument === '--workspace') {
      const workspace = argv[++index];
      if (!workspace || workspace.startsWith('--'))
        throw new Error('--workspace needs a workspace ID or unique name.');
      request.workspace = workspace;
      continue;
    }
    if (!literal && argument.startsWith('-')) throw new Error(`Unknown Viewer option: ${argument}`);
    const expanded =
      argument === '~'
        ? home
        : argument.startsWith('~/')
          ? home.replace(/[\\/]$/, '') + argument.slice(1)
          : argument;
    request.paths.push(resolve(cwd, expanded));
  }
  return launchRequestSchema.parse(request);
}
