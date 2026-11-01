import assert from 'node:assert/strict';
import { until } from '../../owned-app';
import type { ownedApp } from '../../owned-app';
import { pageCall } from './page-function';
import type { PageExpression } from './page-function';

export type CanvasConnection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;
type Connection = CanvasConnection;
export async function canvasFrame(main: Connection, id: string, previousURL?: string) {
  const url = await until(
    () =>
      main.evaluate(
        pageCall(
          (id) =>
            document.querySelector(`[data-canvas-id="${id}"] iframe`)?.getAttribute('src') ?? '',
          id,
        ),
      ),
    (url) => !!url && url !== previousURL,
    'canvas frame',
  );
  const target = await until(
    async () => {
      const all = await main.command<{
        targetInfos: { type: string; url: string; targetId: string }[];
      }>('Target.getTargets');
      return all.targetInfos.find((item) => item.type === 'iframe' && item.url === url);
    },
    Boolean,
    'separate canvas renderer',
  );
  assert.ok(target);
  const { sessionId } = await main.command<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const tree = await main.command<{ frameTree: { frame: { id: string } } }>(
    'Page.getFrameTree',
    {},
    sessionId,
  );
  const { executionContextId } = await main.command<{ executionContextId: number }>(
    'Page.createIsolatedWorld',
    { frameId: tree.frameTree.frame.id, worldName: 'canvas-rehearsal', grantUniveralAccess: false },
    sessionId,
  );
  return {
    url,
    sessionId,
    async evaluate<T>(expression: PageExpression<T>): Promise<T> {
      const result = await main.command<{ result: { value: T }; exceptionDetails?: unknown }>(
        'Runtime.evaluate',
        { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      assert.equal(result.exceptionDetails, undefined);
      return result.result.value;
    },
  };
}
