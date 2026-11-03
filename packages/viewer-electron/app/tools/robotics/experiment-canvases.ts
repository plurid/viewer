import {
  experimentDocumentSchema,
  experimentSourceSchema,
} from '../../src/domain/robotics/experiment-canvases';
import type { ExperimentDocument } from '../../src/domain/robotics/experiment-canvases';
import type { InspectionResult } from '../../src/domain/files/inspection';
import { parseRobotURDF } from '../../src/domain/robotics/urdf';
import { sourceHash } from '../../src/desktop/canvases/sources';
import { Canvases } from '../../src/desktop/canvases/service';
import type { RobotComparisonReport } from '../../src/domain/robotics/task';
import { robotTaskSchema } from '../../src/domain/robotics/task';
import { placementStudySchema } from '../../src/domain/robotics/placement';
import { checkRobotTask } from '../../src/desktop/robotics/check';
import { checkPlacements } from '../../src/desktop/robotics/placement';
import {
  canvasRobotReport,
  compareCanvasRobots,
  robotInputHash,
} from '../../src/desktop/canvases/robot-check';
import {
  placementBrief,
  placementInputHash,
  canvasPlacementReport,
  comparePlacements,
} from '../../src/desktop/canvases/placement-check';

/** Offline fixtures for reproducing the earlier experiment; never imported by the app. */
export class ExperimentCanvases extends Canvases<ExperimentDocument> {
  protected override parseDocument(value: unknown): ExperimentDocument {
    return experimentDocumentSchema.parse(value);
  }
  override async source(
    owner: number,
    id: string,
    expected: number,
    inspection: InspectionResult,
    sourceID?: string,
  ) {
    const result = await super.source(owner, id, expected, inspection, sourceID);
    if (!inspection.path.endsWith('.urdf'))
      return { ...result, source: experimentSourceSchema.parse(result.source) };
    const source = experimentSourceSchema.parse({
      ...result.source,
      data: {
        ...result.source.data,
        robot: parseRobotURDF(inspection.evidence.find((item) => item.source === 'text')!.text),
      },
    });
    result.source = source;
    result.source.hash = sourceHash(result.source.data);
    await this.serial(async () => {
      const document = await this.load(owner, id);
      await this.save(owner, {
        ...document,
        sources: document.sources.map((source) =>
          source.id === result.source.id ? result.source : source,
        ),
      });
    });
    return { ...result, source };
  }

  checkRobot(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    sourceID: string,
    stateKey: string,
  ) {
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (document.revision !== revision || document.stateRevision !== stateRevision)
        throw new Error('The canvas or its inputs changed. Check the saved task again.');
      const source = document.sources.find((source) => source.id === sourceID);
      if (!source?.data.robot) throw new Error('Choose a bound robot source.');
      const input = robotTaskSchema.parse(document.state[stateKey]);
      checkRobotTask(source.data.robot, input);
      return this.save(owner, {
        ...document,
        robotCheck: {
          sourceID,
          stateKey,
          revision,
          sourceHash: source.hash,
          inputHash: robotInputHash(input),
          checker: 'position-v1',
          at: Date.now(),
        },
      });
    });
  }
  checkPlacements(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    sourceID: string,
    briefSourceID: string,
    stateKey: string,
  ) {
    return this.serial(async () => {
      const document = await this.load(owner, id);
      if (document.revision !== revision || document.stateRevision !== stateRevision)
        throw new Error('The study changed. Check its current saved inputs.');
      const source = document.sources.find((s) => s.id === sourceID);
      const brief = document.sources.find((s) => s.id === briefSourceID);
      if (!source?.data.robot || !brief)
        throw new Error('Bind the robot and placement brief first.');
      const input = placementStudySchema.parse(document.state[stateKey]);
      checkPlacements(source.data.robot, placementBrief(brief), input);
      return this.save(owner, {
        ...document,
        placementCheck: {
          sourceID,
          briefSourceID,
          stateKey,
          revision,
          sourceHash: source.hash,
          briefHash: brief.hash,
          inputHash: placementInputHash(input),
          checker: 'placement-v1',
          at: Date.now(),
        },
      });
    });
  }
  placementComparison(owner: number, id: string) {
    return this.serial(async () => {
      const alternative = await this.load(owner, id);
      if (!alternative.fork)
        return { status: 'unavailable' as const, reason: 'This study has no quoted original.' };
      return comparePlacements(await this.load(owner, alternative.fork.id), alternative);
    });
  }
  async savePlacementCheck(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    choose: () => Promise<string | undefined>,
  ) {
    const document = await this.read(owner, id);
    const report = canvasPlacementReport(document);
    if (report?.status !== 'checked')
      throw new Error('Check the current placements before saving.');
    const binding = document.placementCheck!;
    return this.saveResult(
      owner,
      id,
      revision,
      stateRevision,
      {
        format: 'json',
        name: 'placement-check.json',
        content: JSON.stringify(
          {
            version: 1,
            checker: binding.checker,
            sourceHash: binding.sourceHash,
            briefHash: binding.briefHash,
            inputHash: binding.inputHash,
            ...report,
          },
          null,
          2,
        ),
      },
      choose,
      (current) => {
        if (JSON.stringify(current.placementCheck) !== JSON.stringify(binding))
          throw new Error('The placement check changed during save review.');
      },
    );
  }
  async saveRobotCheck(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    choose: () => Promise<string | undefined>,
  ) {
    const document = await this.read(owner, id);
    const report = canvasRobotReport(document);
    if (!report || report.status !== 'checked')
      throw new Error('Check the current task before saving the result.');
    const source = document.sources.find((source) => source.id === document.robotCheck!.sourceID)!;
    return this.saveResult(
      owner,
      id,
      revision,
      stateRevision,
      {
        format: 'json',
        name: 'robot-check.json',
        content: JSON.stringify(
          {
            version: 1,
            checker: document.robotCheck!.checker,
            source: { name: source.name, hash: source.hash, version: source.version },
            inputHash: document.robotCheck!.inputHash,
            ...report,
          },
          null,
          2,
        ),
      },
      choose,
      (current) => {
        if (JSON.stringify(current.robotCheck) !== JSON.stringify(document.robotCheck))
          throw new Error('The selected robot check changed. Review the current result.');
      },
    );
  }
  robotComparison(owner: number, id: string): Promise<RobotComparisonReport> {
    return this.serial(async () => {
      const alternative = await this.load(owner, id);
      if (!alternative.fork)
        return { status: 'unavailable', reason: 'This canvas has no original to compare.' };
      return compareCanvasRobots(await this.load(owner, alternative.fork.id), alternative);
    });
  }
  async saveRobotComparison(
    owner: number,
    id: string,
    revision: number,
    stateRevision: number,
    choose: () => Promise<string | undefined>,
  ) {
    const comparison = await this.robotComparison(owner, id);
    if (comparison.status !== 'compared') throw new Error(comparison.reason);
    return this.saveResult(
      owner,
      id,
      revision,
      stateRevision,
      {
        format: 'json',
        name: 'robot-comparison.json',
        content: JSON.stringify({ version: 1, checker: 'position-v1', ...comparison }, null, 2),
      },
      choose,
      async (current) => {
        if (
          !current.fork ||
          JSON.stringify(compareCanvasRobots(await this.load(owner, current.fork.id), current)) !==
            JSON.stringify(comparison)
        )
          throw new Error('One of the compared tasks changed. Review the comparison again.');
      },
    );
  }
}
