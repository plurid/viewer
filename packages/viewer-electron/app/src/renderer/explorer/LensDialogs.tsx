import { useRef, useState } from 'react';
import {
  lensGroupTree,
  lensRuleSchema,
  lensTypes,
  newLensGroupID,
  type LensDocument,
  type LensGroup,
  type LensOp,
  type LensRect,
  type LensRule,
} from '../../domain/files/lenses';
import { createLens, editLens, trashLens } from '../state/lenses';
import { folderPresentation, report, updateFolderPresentation } from '../state/store';
import { Dialog, NameDialog } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { ChoiceButton } from '../ui/ChoiceMenu';

export type LensPrompt =
  | { kind: 'new-lens'; folder: string }
  | { kind: 'rename-lens'; folder: string; document: LensDocument }
  /** A new group, optionally inside another and holding the named items. Without a lens, one
   * is created first. */
  | {
      kind: 'new-group';
      folder: string;
      document?: LensDocument;
      parent?: string;
      names?: string[];
      /** Where a group made on the Map goes, inside its parent. */
      rect?: LensRect;
    }
  | { kind: 'rename-group'; folder: string; document: LensDocument; group: LensGroup }
  | { kind: 'move'; folder: string; document: LensDocument; names: string[] }
  | { kind: 'rules'; folder: string; document: LensDocument; group: LensGroup }
  | { kind: 'trash-lens'; folder: string; document: LensDocument };

export function useLensDialogs() {
  const [prompt, setPrompt] = useState<LensPrompt | null>(null);
  return {
    open: setPrompt,
    content: prompt ? (
      <LensDialog
        key={prompt.kind}
        prompt={prompt}
        open={setPrompt}
        onClose={() => setPrompt(null)}
      />
    ) : null,
  };
}
/** Shows the folder grouped by `lens`, unless it already is. */
function showLens(folder: string, lens: string) {
  const presentation = folderPresentation(folder);
  if (presentation.group !== 'lens' || presentation.lens !== lens)
    updateFolderPresentation(folder, { group: 'lens', lens });
}
const items = (names: readonly string[]) =>
  names.length === 1 ? `“${names[0]}”` : `${names.length.toLocaleString()} items`;

function LensDialog({
  prompt,
  open,
  onClose,
}: {
  prompt: LensPrompt;
  open(prompt: LensPrompt): void;
  onClose(): void;
}) {
  if (prompt.kind === 'new-lens')
    return (
      <NameDialog
        title="New Lens"
        label="Lens name"
        action="Create"
        maxLength={100}
        initial="By "
        onClose={onClose}
        onSubmit={async (name) => {
          const created = await createLens(prompt.folder, name.trim());
          showLens(prompt.folder, created.lens.id);
        }}
      />
    );
  if (prompt.kind === 'rename-lens')
    return (
      <NameDialog
        title="Rename Lens"
        label="Lens name"
        action="Rename"
        maxLength={100}
        initial={prompt.document.lens.name}
        onClose={onClose}
        onSubmit={(name) =>
          editLens(
            prompt.folder,
            prompt.document.file,
            [{ kind: 'set-lens', name: name.trim() }],
            'Rename lens',
          )
        }
      />
    );
  if (prompt.kind === 'new-group') {
    const names = prompt.names ?? [];
    return (
      <NameDialog
        title={names.length ? `Group ${items(names)}` : 'New Group'}
        label="Group name"
        action={names.length ? 'Group' : 'Create'}
        maxLength={100}
        onClose={onClose}
        onSubmit={async (name) => {
          const groups = prompt.document?.lens.groups ?? [];
          const siblings = groups.filter((group) => group.parent === prompt.parent);
          const id = newLensGroupID(groups.map((group) => group.id));
          const ops: LensOp[] = [
            {
              kind: 'set-group',
              group: {
                id,
                name: name.trim(),
                order: Math.max(-1, ...siblings.map((group) => group.order)) + 1,
                ...(prompt.parent ? { parent: prompt.parent } : {}),
                ...(prompt.rect ? { rect: prompt.rect } : {}),
              },
            },
            ...names.map((item): LensOp => ({ kind: 'place', name: item, group: id })),
          ];
          const label = names.length ? `Group ${items(names)}` : `New group “${name.trim()}”`;
          if (prompt.document) {
            editLens(prompt.folder, prompt.document.file, ops, label);
            showLens(prompt.folder, prompt.document.lens.id);
          } else {
            const created = await createLens(prompt.folder, 'Groups', ops, label);
            showLens(prompt.folder, created.lens.id);
          }
        }}
      />
    );
  }
  if (prompt.kind === 'rename-group')
    return (
      <NameDialog
        title="Rename Group"
        label="Group name"
        action="Rename"
        maxLength={100}
        initial={prompt.group.name}
        onClose={onClose}
        onSubmit={(name) =>
          editLens(
            prompt.folder,
            prompt.document.file,
            [{ kind: 'set-group', group: { ...prompt.group, name: name.trim() } }],
            'Rename group',
          )
        }
      />
    );
  if (prompt.kind === 'move') return <MoveDialog prompt={prompt} open={open} onClose={onClose} />;
  if (prompt.kind === 'rules') return <RulesDialog prompt={prompt} onClose={onClose} />;
  return <TrashLensDialog prompt={prompt} onClose={onClose} />;
}

function MoveDialog({
  prompt,
  open,
  onClose,
}: {
  prompt: Extract<LensPrompt, { kind: 'move' }>;
  open(prompt: LensPrompt): void;
  onClose(): void;
}) {
  const place = (group: string | null, label: string) => {
    editLens(
      prompt.folder,
      prompt.document.file,
      prompt.names.map((name): LensOp => ({ kind: 'place', name, group })),
      `Move to “${label}”`,
    );
    onClose();
  };
  const tree = lensGroupTree(prompt.document.lens);
  return (
    <Dialog
      title={`Move ${items(prompt.names)} to Group`}
      onClose={onClose}
      className="lens-move-dialog"
    >
      <p className="dialog-copy muted">
        Groups organize this folder in the lens “{prompt.document.lens.name}”. Nothing moves on
        disk.
      </p>
      <div className="lens-group-choices" role="list">
        {tree.map(({ group, depth }, index) => (
          <button
            key={group.id}
            role="listitem"
            data-autofocus={index === 0 ? true : undefined}
            style={{ paddingInlineStart: 12 + depth * 18 }}
            onClick={() => place(group.id, group.name)}
          >
            <Icon name="lens" size={14} />
            {group.name}
          </button>
        ))}
        <button role="listitem" onClick={() => place(null, 'Unsorted')}>
          <Icon name="list" size={14} />
          {prompt.document.lens.unsorted?.name ?? 'Unsorted'}
        </button>
      </div>
      <footer>
        <button
          onClick={() =>
            open({
              kind: 'new-group',
              folder: prompt.folder,
              document: prompt.document,
              names: prompt.names,
            })
          }
        >
          New Group…
        </button>
        <button onClick={onClose}>Cancel</button>
      </footer>
    </Dialog>
  );
}

interface DraftRule {
  kind: LensRule['kind'];
  text: string;
  type: (typeof lensTypes)[number];
  year: string;
  from: string;
  to: string;
}
const draft = (rule?: LensRule): DraftRule => ({
  kind: rule?.kind ?? 'name',
  text:
    rule?.kind === 'name' ? rule.glob : rule?.kind === 'extension' ? rule.values.join(', ') : '',
  type: rule?.kind === 'type' ? rule.value : 'folder',
  year:
    (rule?.kind === 'created' || rule?.kind === 'modified') && rule.year ? String(rule.year) : '',
  from: (rule?.kind === 'created' || rule?.kind === 'modified') && rule.from ? rule.from : '',
  to: (rule?.kind === 'created' || rule?.kind === 'modified') && rule.to ? rule.to : '',
});
function finish(value: DraftRule): unknown {
  if (value.kind === 'name') return { kind: 'name', glob: value.text.trim() };
  if (value.kind === 'extension')
    return {
      kind: 'extension',
      values: value.text
        .split(/[\s,]+/)
        .map((item) => item.replace(/^\./, '').toLowerCase())
        .filter(Boolean),
    };
  if (value.kind === 'type') return { kind: 'type', value: value.type };
  return {
    kind: value.kind,
    ...(value.year.trim() ? { year: Number(value.year) } : {}),
    ...(value.from ? { from: value.from } : {}),
    ...(value.to ? { to: value.to } : {}),
  };
}
const typeLabels: Record<(typeof lensTypes)[number], string> = {
  folder: 'Folder',
  file: 'Any file',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
  drawing: 'Drawing',
  model: '3D model',
  archive: 'Archive',
  data: 'Data',
  code: 'Code',
};
function RulesDialog({
  prompt,
  onClose,
}: {
  prompt: Extract<LensPrompt, { kind: 'rules' }>;
  onClose(): void;
}) {
  const [match, setMatch] = useState(prompt.group.match ?? 'all');
  const [rules, setRules] = useState<DraftRule[]>(
    prompt.group.rules?.length ? prompt.group.rules.map(draft) : [draft()],
  );
  const [error, setError] = useState('');
  const change = (index: number, patch: Partial<DraftRule>) =>
    setRules((value) => value.map((rule, item) => (item === index ? { ...rule, ...patch } : rule)));
  const save = () => {
    const parsed: LensRule[] = [];
    for (const rule of rules) {
      if (rule.kind === 'name' && !rule.text.trim()) continue;
      const result = lensRuleSchema.safeParse(finish(rule));
      if (!result.success) {
        setError(
          rule.kind === 'extension'
            ? 'Use extensions such as step, stp or pdf.'
            : rule.kind === 'created' || rule.kind === 'modified'
              ? 'Use a year such as 2025, or a range of dates.'
              : 'Check the highlighted rule.',
        );
        return;
      }
      parsed.push(result.data);
    }
    const { rules: _, match: __, ...group } = prompt.group;
    editLens(
      prompt.folder,
      prompt.document.file,
      [
        {
          kind: 'set-group',
          group: {
            ...group,
            ...(parsed.length ? { rules: parsed } : {}),
            ...(parsed.length > 1 && match === 'any' ? { match } : {}),
          },
        },
      ],
      `Edit rules of “${prompt.group.name}”`,
    );
    onClose();
  };
  return (
    <Dialog
      title={`Rules for “${prompt.group.name}”`}
      onClose={onClose}
      wide
      className="lens-rules-dialog"
    >
      <p className="dialog-copy muted">
        Items you have not placed by hand join the most specific group whose rules they match. A
        group without rules holds only what you put in it.
      </p>
      {rules.length > 1 && (
        <label className="lens-rule-match">
          Items must match
          {/* lowercase: the choice completes the sentence its label starts */}
          <ChoiceButton
            label="Items must match"
            value={match}
            choices={[
              { value: 'all', label: 'every rule' },
              { value: 'any', label: 'any rule' },
            ]}
            onChoose={(value) => setMatch(value as 'all' | 'any')}
          />
        </label>
      )}
      <ul className="lens-rules">
        {rules.map((rule, index) => (
          <li key={index}>
            <ChoiceButton
              label="Rule"
              value={rule.kind}
              choices={[
                { value: 'name', label: 'Name matches' },
                { value: 'extension', label: 'Extension is' },
                { value: 'type', label: 'Type is' },
                { value: 'created', label: 'Created' },
                { value: 'modified', label: 'Modified' },
              ]}
              onChoose={(kind) => change(index, { kind: kind as DraftRule['kind'] })}
            />
            {rule.kind === 'name' || rule.kind === 'extension' ? (
              <input
                aria-label={rule.kind === 'name' ? 'Name pattern' : 'Extensions'}
                placeholder={rule.kind === 'name' ? '2025-*  or  *bracket*' : 'step, stp, iges'}
                value={rule.text}
                maxLength={200}
                onChange={(event) => change(index, { text: event.target.value })}
              />
            ) : rule.kind === 'type' ? (
              <ChoiceButton
                label="Type"
                value={rule.type}
                choices={lensTypes.map((type) => ({ value: type, label: typeLabels[type] }))}
                onChoose={(type) => change(index, { type: type as DraftRule['type'] })}
              />
            ) : (
              <span className="lens-rule-dates">
                in
                <input
                  aria-label="Year"
                  inputMode="numeric"
                  placeholder="2026"
                  value={rule.year}
                  maxLength={4}
                  onChange={(event) => change(index, { year: event.target.value })}
                />
                from
                <input
                  type="date"
                  aria-label="From"
                  value={rule.from}
                  onChange={(event) => change(index, { from: event.target.value })}
                />
                to
                <input
                  type="date"
                  aria-label="To"
                  value={rule.to}
                  onChange={(event) => change(index, { to: event.target.value })}
                />
              </span>
            )}
            <button
              aria-label="Remove rule"
              onClick={() => setRules((value) => value.filter((_, item) => item !== index))}
            >
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button
          disabled={rules.length >= 16}
          onClick={() => setRules((value) => [...value, draft()])}
        >
          Add Rule
        </button>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>
          Save
        </button>
      </footer>
    </Dialog>
  );
}

function TrashLensDialog({
  prompt,
  onClose,
}: {
  prompt: Extract<LensPrompt, { kind: 'trash-lens' }>;
  onClose(): void;
}) {
  const submitted = useRef(false);
  const confirm = () => {
    if (submitted.current) return;
    submitted.current = true;
    void trashLens(prompt.folder, prompt.document.file)
      .then(() => {
        const presentation = folderPresentation(prompt.folder);
        if (presentation.group === 'lens' && presentation.lens === prompt.document.lens.id)
          updateFolderPresentation(prompt.folder, { group: 'none' });
      })
      .catch(report);
    onClose();
  };
  return (
    <Dialog title="Move Lens to Trash?" onClose={onClose} className="trash-dialog">
      <p className="dialog-copy">
        Move the lens “{prompt.document.lens.name}” to the system Trash? Its groups and places go
        with it; the items in this folder stay where they are.
        {prompt.document.local ? '' : ' Undo puts the lens back.'}
      </p>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" data-autofocus onClick={confirm}>
          Move to Trash
        </button>
      </footer>
    </Dialog>
  );
}
