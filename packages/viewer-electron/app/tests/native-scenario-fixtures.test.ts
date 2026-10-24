import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createScenarioFixtures,
  longFilename,
  scenarioSettings,
} from './native/fixtures/scenarios';

describe('native scenario fixtures', () => {
  it('prepares milestone Git and image comparisons before native launch', async () => {
    const fixture = await createScenarioFixtures({ scenario: 'milestones' });
    expect(await readFile(path.join(fixture.files, '.git/HEAD'), 'utf8')).toBe(
      'ref: refs/heads/main\n',
    );
    expect(await readFile(path.join(fixture.files, 'README.md'), 'utf8')).toBe(
      '# Working version\n\nA changed file for comparison.\n',
    );
    expect(fixture.state.workspaces[0]?.panes).toContainEqual({
      id: 'milestone-image',
      type: 'diff',
      path: path.join(fixture.files, 'Images/Comparison.png'),
      left: { kind: 'file', path: path.join(fixture.files, 'Images/Comparison before.png') },
      right: { kind: 'file', path: path.join(fixture.files, 'Images/Comparison.png') },
      mode: 'slider',
    });
    expect(fixture.state.workspaces[0]?.roots).toContain('milestone-image');
    const settings = scenarioSettings(fixture, 'milestones');
    expect(settings.version).toBe(1);
    expect(settings.settings.git.enabled).toBe(true);
    expect(await readdir(fixture.root)).not.toContain('profile');
  });

  it('keeps chrome fixtures separate from the ordinary performance baseline', async () => {
    const chrome = await createScenarioFixtures({ scenario: 'chrome' });
    expect(await readFile(path.join(chrome.files, longFilename), 'utf8')).toBe(
      'Generated long-filename layout fixture.',
    );
    const performance = await createScenarioFixtures({ scenario: 'performance' });
    expect(await readdir(performance.files)).not.toContain(longFilename);
    expect(await readdir(performance.files)).not.toContain('.git');
    expect(performance.state.workspaces[0]?.panes).toHaveLength(1);
    expect(scenarioSettings(performance, 'performance').settings.git.enabled).toBe(false);
  });

  it('preserves foundation shell fixture arguments and creates no program execution', async () => {
    const fixture = await createScenarioFixtures();
    const settings = scenarioSettings(fixture, 'foundations');
    expect(settings.settings.terminals.profiles).toEqual([
      { id: 'login', name: 'Fixture shell', executable: '/bin/sh', args: [], env: {} },
    ]);
    expect(settings.settings.customActions).toMatchObject([
      {
        id: 'inspect-path',
        executor: { kind: 'executable', args: ['%s\\n', '{directory}'], perItem: false },
      },
    ]);
    expect(await readdir(fixture.root)).not.toContain('profile');
  });
});
