import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PreviewFrame } from '../../src/renderer/previews/controls';
import { PreviewCommandList, PreviewFrameContext } from '../../src/renderer/previews/controls';

/**
 * What a preview host gives a module rendered alone: its commands, and a footer showing the facts
 * its toolbar moved there, each fact its own element, as an image's dimensions or a
 * compatibility copy's label.
 */
export function PreviewFrameFixture({ children }: { children: ReactNode }) {
  const [facts, setFacts] = useState<Record<string, readonly string[]>>({});
  const [commands] = useState(() => new PreviewCommandList());
  const frame = useMemo<PreviewFrame>(
    () => ({
      details: (id, values) => {
        setFacts((current) => ({ ...current, [id]: values }));
        return () =>
          setFacts((current) => {
            const rest = { ...current };
            delete rest[id];
            return rest;
          });
      },
      commands,
    }),
    [commands],
  );
  return (
    <div className="preview-host">
      <PreviewFrameContext value={frame}>{children}</PreviewFrameContext>
      <footer aria-label="Footer facts">
        {Object.values(facts)
          .flat()
          .map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
      </footer>
    </div>
  );
}
