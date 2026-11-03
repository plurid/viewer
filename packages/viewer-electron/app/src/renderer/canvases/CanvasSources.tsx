import type { CanvasSource } from '../../domain/canvases/sources';
import { Disclosure } from '../ui/Disclosure';
import { useWorkspace } from '../workspace/context';

export function CanvasSources({
  sources,
  paneID,
  busy,
  onRefresh,
  onError,
}: {
  sources: readonly CanvasSource[];
  paneID: string;
  busy: boolean;
  onRefresh(id: string): void;
  onError(error: unknown): void;
}) {
  const workspace = useWorkspace();
  return (
    <ul className="canvas-sources">
      {sources.map((source) => {
        const evidence = source.data.evidence.find((item) => item.anchor);
        const anchor = evidence?.anchor;
        return (
          <li key={source.id}>
            <div className="canvas-source-heading">
              <strong>{source.name}</strong>
              {source.path && (
                <>
                  <button
                    onClick={() =>
                      void (
                        anchor
                          ? workspace.openEvidence(
                              {
                                path: source.path!,
                                version: source.version,
                                anchor,
                                quote: evidence!.text.slice(0, 200),
                              },
                              paneID,
                            )
                          : workspace.openPath(source.path!, {
                              paneID,
                              linked: true,
                              activate: true,
                            })
                      ).catch(onError)
                    }
                  >
                    Open source
                  </button>
                  <button disabled={busy} onClick={() => onRefresh(source.id)}>
                    Refresh snapshot
                  </button>
                </>
              )}
            </div>
            <p>
              {source.path ? 'Saved snapshot' : 'Portable snapshot'}
              {source.data.coverage.content !== 'complete' && ' · Partial source'}
            </p>
            {source.data.coverage.reason && <p>{source.data.coverage.reason}</p>}
            <Disclosure variant="compact" summary="Inspect captured data">
              <pre tabIndex={0}>
                {source.data.evidence.length
                  ? source.data.evidence.map((item) => item.text).join('\n\n')
                  : JSON.stringify(source.data.facts, null, 2)}
              </pre>
            </Disclosure>
          </li>
        );
      })}
    </ul>
  );
}
