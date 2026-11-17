import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parse } from 'jsonc-parser';
import {
  definitionPlaneSchema,
  workspacesFileSchema,
} from '../src/domain/workspaces/definitions/schema';
import { resolveCatalog } from '../src/domain/workspaces/definitions/catalog';
import { hashDefinition, sampleProject } from './workspace-definition-fixtures';
import { schemas } from '../src/desktop/ipc/schemas';

describe('definition command validation', () => {
  it.each(['echo ✔\uFE0F built', 'echo ⚠\uFE0E check', 'echo 👩\u200D💻', 'echo 🏳\uFE0F\u200D🌈'])(
    'accepts emoji presentation and joins in a definition: %j',
    (command) => {
      expect(
        definitionPlaneSchema.safeParse({ kind: 'terminal', path: '.', command }).success,
      ).toBe(true);
    },
  );
  it.each([
    ['echo\tcompletion', 'tabs'],
    ['echo\nsecond', 'one line'],
    ['echo\0hidden', 'control'],
    ['echo\u202ehidden', 'formatting'],
    ['echo\ud800', 'surrogates'],
    ['echo\u3164', 'invisible'],
    ['echo\u115F', 'invisible'],
    ['echo\u034F', 'invisible'],
    ['echo\uFE0F', 'invisible'],
    ['echo\u{E0100}', 'invisible'],
    ['echo\u17B4', 'invisible'],
    ['echo\u180B', 'invisible'],
  ])(
    'names the actual problem in %j without changing the editor schema type',
    (command, problem) => {
      const result = definitionPlaneSchema.safeParse({ kind: 'terminal', path: '.', command });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]!.message).toContain(problem);
      const schema = z.toJSONSchema(definitionPlaneSchema, { unrepresentable: 'any' });
      expect(JSON.stringify(schema)).toContain(
        '"command":{"type":"string","minLength":1,"maxLength":1000}',
      );
    },
  );

  it('falls back to the project stub and points at the line containing a tab command', () => {
    const text = [
      '{ "version": 1, "workspaces": {',
      '  "sample/site": {',
      '    "planes": [{ "kind": "terminal", "path": ".",',
      '      "command": "echo\\tcompletion"',
      '    }]',
      '  }',
      '} }',
    ].join('\n');
    const result = resolveCatalog({
      file: workspacesFileSchema.parse(parse(text)),
      projects: [sampleProject()],
      home: '/home/sample',
      hash: hashDefinition,
      text,
    });
    expect(result.definitions[0]!.source).toBe('project-manager');
    expect(result.definitions[0]!.planes.every((item) => item.plane.kind === 'folder')).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        key: 'sample/site',
        line: 4,
        message: expect.stringContaining('Remove tabs'),
      }),
    );
  });

  it.each(['command', 'initialInput', 'ticket'] as const)(
    'never accepts %s in a start or Run all reference',
    (field) => {
      const request = {
        id: 'terminal',
        workspaceID: 'workspace',
        rootID: 'terminal',
        cwd: '/fixture',
        profileID: 'login',
        cols: 80,
        rows: 24,
      };
      const reference = { key: 'sample/site', plane: 0, basis: 'basis', [field]: 'echo injected' };
      expect(schemas.terminalStart.safeParse([request, reference]).success).toBe(false);
      expect(schemas.terminalStartAll.safeParse([[{ request, ...reference }]]).success).toBe(false);
    },
  );
});
