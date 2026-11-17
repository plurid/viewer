import { Button } from '../primitives';

export const projectManagerConsentText =
  'VS Code Project Manager has a project list on this Mac. Use its projects as defined workspaces? Viewer reads the list and never changes it.';

export function ProjectManagerOffer({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose(enabled: boolean): void;
}) {
  return (
    <section className="workspace-project-manager-offer" aria-label="Use VS Code Projects">
      <p>{projectManagerConsentText}</p>
      <div>
        <Button variant="primary" disabled={busy} onClick={() => onChoose(true)}>
          Use VS Code Projects
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onChoose(false)}>
          Don’t Use
        </Button>
      </div>
    </section>
  );
}
