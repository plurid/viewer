import { z } from 'zod';
import { inspectionResultSchema } from '../../domain/inspection';
import { workflowArtifactSchema } from '../../domain/workflows';
import { useWorkspace } from '../workspace/context';
import { report } from '../state/store';

const inspections = z.object({
  kind: z.literal('inspection'),
  results: z.array(inspectionResultSchema).max(100),
});
const comparison = z.object({
  kind: z.literal('comparison'),
  result: z.object({
    coverage: z.enum(['complete', 'partial']),
    rows: z.array(z.object({ status: z.string() })),
  }),
});
export function WorkflowArtifact({ value }: { value: z.infer<typeof workflowArtifactSchema> }) {
  const workspace = useWorkspace();
  const inspection = inspections.safeParse(value);
  if (inspection.success)
    return (
      <div className="workflow-facts">
        {inspection.data.results.map((result) => (
          <details key={result.path}>
            <summary>
              {result.path.split('/').pop()} ·{' '}
              {result.coverage.content === 'not-requested'
                ? 'Metadata'
                : 'Content ' + result.coverage.content}
            </summary>
            <p className="muted inspection-path">{result.path}</p>
            <dl className="inspection-facts">
              {Object.entries(result.facts).map(([name, fact]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    {String(fact.value)}
                    {fact.unit ? ' ' + fact.unit : ''}
                  </dd>
                </div>
              ))}
            </dl>
            {result.coverage.reason && <p className="muted">{result.coverage.reason}</p>}
            {result.evidence
              .filter((item) => item.anchor)
              .slice(0, 10)
              .map((item, index) => (
                <button
                  key={index}
                  className="inspection-passage"
                  onClick={() =>
                    void workspace
                      .openEvidence({
                        path: result.path,
                        version: result.version,
                        anchor: item.anchor!,
                        quote: item.text.slice(0, 1000),
                      })
                      .catch(report)
                  }
                >
                  <strong>{item.source}</strong>
                  <span>{item.text.slice(0, 200)}</span>
                </button>
              ))}
          </details>
        ))}
      </div>
    );
  const compared = comparison.safeParse(value);
  if (compared.success) {
    const counts = new Map<string, number>();
    for (const row of compared.data.result.rows)
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return (
      <div className="workflow-facts">
        <span>Comparison · {compared.data.result.coverage}</span>
        <dl className="inspection-facts">
          {[...counts].map(([status, count]) => (
            <div key={status}>
              <dt>{status.replaceAll('-', ' ')}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  return <p className="muted workflow-receipt">Completed task receipt saved.</p>;
}
