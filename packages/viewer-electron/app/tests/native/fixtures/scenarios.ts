/** Scenario-specific data is seeded before any owned native application is launched. */
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { strToU8, zipSync } from 'fflate';
import { defaultSettings } from '../../../src/domain/services';
import { normalizePreferences } from '../../../src/domain/preferences/ui';
import { createFixtures, sizedImageFixture } from '../../fixtures';
import { panelDrawing } from '../../dxf-fixtures';

export interface ScenarioFixtureOptions {
  scenario?: string;
  stepFile?: string;
  dxfFile?: string;
}

export type NativeScenarioFixture = Awaited<ReturnType<typeof createFixtures>>;

export const longFilename =
  '2000, J. E. Rehder, The mastery and uses of fire in antiquity, McGill-Queen’s University Press, notes and references for the publication naming workflow.txt';

const execNative = promisify(execFile);

export async function createScenarioFixtures(
  options: ScenarioFixtureOptions = {},
): Promise<NativeScenarioFixture> {
  const fixture = await createFixtures();
  if (options.scenario === 'milestones') {
    const git = (...args: string[]) =>
      execNative('/usr/bin/git', [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'commit.gpgsign=false',
        '-C',
        fixture.files,
        ...args,
      ]);
    await git('init', '--initial-branch=main');
    await git('add', '--', 'README.md');
    await git(
      '-c',
      'user.name=Viewer QA',
      '-c',
      'user.email=qa@example.invalid',
      'commit',
      '-m',
      'Fixture',
    );
    await writeFile(
      path.join(fixture.files, 'README.md'),
      '# Working version\n\nA changed file for comparison.\n',
    );
    const leftImage = path.join(fixture.files, 'Images', 'Comparison before.png');
    const rightImage = path.join(fixture.files, 'Images', 'Comparison.png');
    await writeFile(leftImage, sizedImageFixture(64, 64));
    await writeFile(rightImage, sizedImageFixture(128, 96));
    fixture.state.workspaces[0]!.panes.push({
      id: 'milestone-image',
      type: 'diff',
      path: rightImage,
      left: { kind: 'file', path: leftImage },
      right: { kind: 'file', path: rightImage },
      mode: 'slider',
    });
    fixture.state.workspaces[0]!.roots.push('milestone-image');
  }
  if (options.scenario === 'daily-file-work')
    await writeFile(path.join(fixture.files, 'Images', 'Wide.png'), sizedImageFixture(2048, 1280));
  if (options.scenario === 'refinements') {
    const require = createRequire(import.meta.url);
    await writeFile(
      path.join(fixture.files, 'Cube.step'),
      await readFile(
        path.join(
          path.dirname(require.resolve('occt-import-js/package.json')),
          'test/testfiles/simple-basic-cube/cube.stp',
        ),
      ),
    );
    await writeFile(path.join(fixture.files, 'Broken.step'), 'not a STEP file');
    await writeFile(
      path.join(fixture.files, 'Printed.3mf'),
      zipSync({
        '_rels/.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>',
        ),
        '3D/3dmodel.model': strToU8(
          '<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
        ),
      }),
    );
    await writeFile(
      path.join(fixture.files, 'Triangle.ply'),
      'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n',
    );
    if (options.stepFile)
      await writeFile(
        path.join(fixture.files, 'User panel.step'),
        await readFile(options.stepFile),
      );
  }
  if (options.scenario === 'model-lighting') {
    const require = createRequire(import.meta.url);
    const model =
      options.stepFile ||
      path.join(
        path.dirname(require.resolve('occt-import-js/package.json')),
        'test/testfiles/simple-basic-cube/cube.stp',
      );
    await writeFile(path.join(fixture.files, 'Models', 'Lighting.step'), await readFile(model));
  }
  if (options.scenario === 'drawings-workspaces') {
    await writeFile(path.join(fixture.files, 'Panel.dxf'), panelDrawing);
    await writeFile(path.join(fixture.files, 'Broken.dxf'), '0\nSECTION\n');
    if (options.dxfFile)
      await writeFile(path.join(fixture.files, 'User panel.dxf'), await readFile(options.dxfFile));
    fixture.state.workspaces.push({
      id: 'engineering-fixture',
      name: 'Engineering',
      panes: [],
      roots: [],
      arrangement: {},
    });
  }
  if (options.scenario === 'chrome')
    await writeFile(
      path.join(fixture.files, longFilename),
      'Generated long-filename layout fixture.',
    );
  if (options.scenario === 'file-workflows') {
    for (const folder of ['Source', 'Target', 'Peer'])
      await mkdir(path.join(fixture.files, 'Transfers', folder));
    await writeFile(
      path.join(fixture.files, 'Transfers', 'Source', 'Note.txt'),
      'Generated clipboard and drag fixture.',
    );
  }
  return fixture;
}

/** Legacy input exercises the same Settings migration as the original native suite. */
export function scenarioSettings(fixture: NativeScenarioFixture, scenario?: string) {
  const settings = defaultSettings(fixture.files);
  return {
    version: 1,
    revision: 0,
    settings: {
      ...settings,
      appearance: fixture.state.look,
      ...(scenario === 'milestones' ? { git: { enabled: true } } : {}),
      ...(scenario === 'foundations'
        ? {
            terminals: {
              ...settings.terminals,
              profiles: [
                { id: 'login', name: 'Fixture shell', executable: '/bin/sh', args: [], env: {} },
              ],
            },
            customActions: [
              {
                id: 'inspect-path',
                name: 'Inspect path',
                aliases: ['ip'],
                icon: 'code',
                shortcut: '',
                order: 0,
                pinned: true,
                when: { target: 'any', extensions: [], min: 0, max: 10000 },
                executor: {
                  kind: 'executable',
                  executable: '/usr/bin/printf',
                  args: ['%s\\n', '{directory}'],
                  perItem: false,
                },
              },
            ],
          }
        : {}),
    },
    ui: normalizePreferences(fixture.state.ui),
  };
}
