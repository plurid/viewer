import { z } from 'zod';
import type { RobotStage } from './rehearsal';

// These are observable inputs and outputs for this experiment, not host capabilities.
export const stationActionContract = `Register these actions using the generic canvas action API:
- evaluate({reserved:boolean,targetOffsetX:number}): solve all mounts against all targets, with targetOffsetX added to every target's world X in metres. reserved enables the rectangular mounting exclusion from the changed requirement. Return {candidates:[{id,poses:[{targetID,positions:{jointName:radians},actual:[x,y,z],residual,withinTolerance,violations:[jointName]}],eligible,movement}],recommended:string|null}. Every movable joint has an explicit value. Include every target even when solving fails; report the best pose and residual, never declare an unsolved target unreachable. eligible means outside the reserved area, within the bench and every returned pose satisfies its target and joint limits. movement is Euclidean base displacement from the brief's reference, in metres. Return a patch with the complete result in state.study, plus state.reserved and state.targetOffsetX. Do not change state.selected in evaluate.
- select({mount:string}): select an evaluated eligible mount, save state.selected and return {selected:string}. Show that mount's poses in the viewport with a target selector. Visible Evaluate and Select controls call these same handlers.
- inspectPose({mount:string,joints:string,targetX:number,targetY:number,targetZ:number,tolerance:number,limitJoint?:string,limitLower?:number,limitUpper?:number}): joints is a JSON object of joint positions. Compute the tool's world position for that mount, compare it with the supplied world target, and check all joint limits without clamping. The optional limit fields replace one joint's limits for this invocation only. Return {actual:[x,y,z],residual,withinTolerance,violations:[jointName]}. This read-only action must use the SAME transforms and checker as evaluate. Do not save probe inputs.
- selfTest({}): run your own deterministic calculation tests, returning {passed:boolean,tests:[{name,passed}]}. Tests must exercise your implementation, not return constants.
All lengths in results are metres; angles are radians. The main UI can display millimetres. Keep action output under 32 KB. Save camera and joint inputs under state.camera and state.ui. Do not run long calculations during initial rendering; register actions first. Yield and honour the action's abort signal during solving. Only the generic host APIs and Three.js, OrbitControls and STLLoader are available. The host has no robotics module or checker. Reuse the attached robotics.js plugin library and existing interface; implement only the requested changes. The plugin owns its calculations and checks. The external test harness is not available to this tool.`;

export const stationPrompts: Record<RobotStage, string> = {
  create:
    'Adapt the existing robotics plugin to this robot and station brief. Test the mounting points and tell me which one needs the smallest move. Use the attached raw snapshots and meshes. Show the bench, two trays, six labelled targets and the articulated robot. Reuse its URDF parser, transforms, bounded position solver and endpoint checks. Invoke evaluate with reserved=false and targetOffsetX=0, run selfTest, then select the least-movement eligible candidate. Explain only the results you receive. Add a per-target results summary so I can see which tray slots each mounting point reaches. Preserve the existing controls. Use flat compact controls, system typography, neutral surfaces and no cards, decorative badges or oversized headings. Keep the model visible and the controls scrollable. Keep the existing implementation and attached code assets. Calculate from the current sources.\n\n' +
    stationActionContract,
  refine:
    'Reserve the central mounting area: X 140 to 260 mm, Y 120 to 240 mm, including its boundary. Use the existing control and bench overlay, and add an explanation of which candidates this restriction excludes. Keep the robot, six targets and 1 mm endpoint tolerance. Revise the existing tool, run evaluate with reserved=true and targetOffsetX=0 and run selfTest, then select the least-movement eligible candidate using the plugin calculations. Preserve the action contract, camera and other inputs. Explain the measured result.',
  branch:
    'Compare the rear mounting point with the front mounting point. Use the same robot, targets and reserved area. Select Rear in this alternative through its registered select action. Use the plugin checker on its saved poses and explain the measured tradeoff. Preserve the action contract. Do not change the source brief or the original conversation inputs.',
};

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const stationPoseResultSchema = z.object({
  actual: vector,
  residual: z.number().finite().nonnegative(),
  withinTolerance: z.boolean(),
  violations: z.array(z.string()).max(64),
});
export const stationStudySchema = z.object({
  candidates: z.array(
    z.object({
      id: z.string(),
      poses: z.array(
        stationPoseResultSchema.extend({
          targetID: z.string(),
          positions: z.record(z.string(), z.number().finite()),
        }),
      ),
      eligible: z.boolean(),
      movement: z.number().finite().nonnegative(),
    }),
  ),
  recommended: z.string().nullable(),
});
export type StationStudy = z.infer<typeof stationStudySchema>;
