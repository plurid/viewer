import { randomUUID } from 'node:crypto';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Canvases } from '../src/desktop/canvases/service';
import { canvasHTML, canvasInstructions } from '../src/desktop/canvases/runtime';
import { sourceSnapshot } from '../src/desktop/canvases/sources';
import { canvasRequestSchema } from '../src/domain/canvases/document';
import { chatStepSchema } from '../src/domain/models/chat';
import { canvasLibraries } from '../tools/canvas-libraries';
import { temporaryRoot } from '../tools/temporary';
import type { CanvasActionEvent } from '../src/domain/canvases/actions';

const action = {
  id: 'check',
  label: 'Check plugin output',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
describe('generated tool host', () => {
  it('supplies graphics modules without domain algorithms or checker APIs', async () => {
    const root = await temporaryRoot('viewer-tool-host-');
    const service = new Canvases(root, { changed() {} });
    const document = await service.create(1, randomUUID(), root);
    const html = canvasHTML(document);
    expect(html).toContain('registerAction');
    expect(html).not.toMatch(/viewer\/robotics|requestRobotCheck|requestPlacementCheck/);
    expect(canvasInstructions).toContain('interface AND its domain logic');
    expect(canvasInstructions).not.toMatch(
      /viewer\/robotics|canvas_check_placements|canvas_robot_assets/,
    );
    const plugin = canvasLibraries();
    const hook = plugin.load!;
    const load = typeof hook === 'function' ? hook : hook.handler;
    const module = await load.call(
      { addWatchFile() {} } as never,
      '\0virtual:viewer-canvas-libraries',
    );
    expect(String(module)).toContain('three.module.js');
    expect(String(module)).not.toMatch(/robotics\.js|solvePosition|forwardKinematics/);
    expect('checkRobot' in service).toBe(false);
    expect('checkPlacements' in service).toBe(false);
    for (const kind of [
      'robot-report',
      'placement-report',
      'robot-comparison',
      'placement-comparison',
    ])
      expect(canvasRequestSchema.safeParse({ kind, id: document.id }).success).toBe(false);
    expect(chatStepSchema.shape.kind.options).not.toContain('canvas_check_placements');
    expect(chatStepSchema.shape.kind.options).not.toContain('canvas_robot_assets');
  });
  it('retains source text without interpreting the application file format', () => {
    const text = '<robot>' + ' '.repeat(15000) + '</robot>';
    const source = sourceSnapshot({
      path: '/project/model.urdf',
      availability: 'available',
      version: { identity: 'fixture', modified: 1, size: text.length },
      facts: {},
      evidence: [{ source: 'text', text }],
      coverage: { content: 'complete' },
    });
    expect(source.data.evidence[0]!.text).toBe(text);
    expect(source.data.coverage.content).toBe('complete');
    expect(source.data).not.toHaveProperty('robot');
  });
  it('lists, renames and disables tools durably without loading another window’s tool', async () => {
    const root = await temporaryRoot('viewer-tool-library-');
    const service = new Canvases(root, { changed() {} });
    const original = await service.create(1, randomUUID(), root);
    const doc = await service.configure(1, original.id, original.revision, 'Image crop', false);
    expect((await service.library(1)).entries[0]).toMatchObject({
      title: 'Image crop',
      enabled: false,
      available: true,
    });
    expect((await service.library(2)).entries[0]).toMatchObject({ available: false });
    await expect(service.configure(2, doc.id, doc.revision, 'Other', true)).rejects.toThrow(
      'another window',
    );
    await expect(service.configure(1, doc.id, 0, 'Stale', true)).rejects.toThrow('changed');
    const fresh = new Canvases(root, { changed() {} });
    expect((await fresh.library(2)).entries[0]).toMatchObject({
      title: 'Image crop',
      enabled: false,
      available: true,
    });
    await expect(
      fresh.registerActions(2, doc.id, doc.revision, randomUUID(), [action]),
    ).rejects.toThrow('Enable');
    await expect(
      fresh.invoke(
        2,
        doc.id,
        doc.revision,
        doc.stateRevision,
        'check',
        {},
        'You',
        new AbortController().signal,
      ),
    ).rejects.toThrow('Enable');
    const corruptID = randomUUID();
    await writeFile(path.join(root, 'canvas-documents', corruptID + '.json'), '{}');
    const linkID = randomUUID();
    await symlink(
      path.join(root, 'canvas-documents', doc.id + '.json'),
      path.join(root, 'canvas-documents', linkID + '.json'),
    );
    const entries = (await fresh.library(2)).entries;
    expect(entries.find((item) => item.id === corruptID)?.available).toBe(false);
    expect(entries.some((item) => item.id === linkID)).toBe(false);
  });
  it('cancels a running plugin when disabled and refuses its late result', async () => {
    const root = await temporaryRoot('viewer-disable-tool-');
    const events: CanvasActionEvent[] = [];
    const service = new Canvases(root, {
      changed() {},
      action: (_owner, event) => events.push(event),
    });
    const doc = await service.create(1, randomUUID(), root);
    const frameID = randomUUID();
    await service.registerActions(1, doc.id, doc.revision, frameID, [action]);
    const running = service.invoke(
      1,
      doc.id,
      doc.revision,
      doc.stateRevision,
      'check',
      {},
      'You',
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'invoke')).toBe(true));
    const run = events[0]!.run;
    await service.configure(1, doc.id, doc.revision, doc.title, false);
    expect((await running).actionRun.status).toBe('cancelled');
    expect(() =>
      service.actions.complete(1, doc.id, frameID, run.id, {
        result: 'late',
        patch: { forged: true },
      }),
    ).toThrow();
    expect((await service.read(1, doc.id)).state).toEqual({});
  });
});
