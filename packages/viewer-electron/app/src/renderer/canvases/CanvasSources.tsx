import type { CanvasSource } from '../../domain/canvases/sources';
import { Disclosure } from '../ui/Disclosure';
import { useWorkspace } from '../workspace/context';

export function CanvasSources({
  sources,
  paneID,
  busy,
  onRefresh,
  onError,
  joint,
}: {
  sources: readonly CanvasSource[];
  paneID: string;
  busy: boolean;
  onRefresh(id: string): void;
  onError(error: unknown): void;
  joint?: { id: string; name: string };
}) {
  const workspace = useWorkspace();
  return (
    <ul className="canvas-sources">
      {[...sources]
        .sort((a, b) => Number(b.id === joint?.id) - Number(a.id === joint?.id))
        .map((source) => {
          const evidence = source.data.evidence.find((item) => item.anchor);
          const definition =
            source.id === joint?.id
              ? source.data.robot?.joints.find((item) => item.name === joint.name)?.definition
              : undefined;
          const anchor = definition
            ? {
                kind: 'text' as const,
                line: definition.line,
                start: definition.start,
                end: definition.end,
              }
            : evidence?.anchor;
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
                                  quote: definition?.quote ?? evidence!.text.slice(0, 200),
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
                      {definition ? 'Open joint definition' : 'Open source'}
                    </button>
                    <button disabled={busy} onClick={() => onRefresh(source.id)}>
                      Refresh snapshot
                    </button>
                  </>
                )}
              </div>
              <p>
                {source.path ? 'Saved snapshot' : 'Portable snapshot'}
                {source.data.robot && ' · Complete joint tree'}
                {source.data.coverage.content !== 'complete' && ' · Partial source'}
              </p>
              {source.data.coverage.reason && <p>{source.data.coverage.reason}</p>}
              {definition && (
                <pre tabIndex={0} aria-label={`${joint!.name} definition`}>
                  {definition.quote}
                </pre>
              )}
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
