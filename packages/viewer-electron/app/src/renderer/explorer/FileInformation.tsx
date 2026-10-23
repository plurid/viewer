import { useEffect, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { formatBytes } from '../../domain/files';
import {
  informationChanges,
  tagColors,
  type FileInformation as Information,
} from '../../domain/file-information';
import { Dialog, IconButton } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { SelectionSize, calculateSize } from './sizes';
import { getState, report } from '../state/store';
import { errorMessage } from '../../domain/errors';

function InformationEditor({ entry }: { entry: FileEntry }) {
  const [original, setOriginal] = useState<Information>();
  const [draft, setDraft] = useState<Information>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [tagName, setTagName] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setOriginal(undefined);
    setDraft(undefined);
    void window.viewer
      .fileInformation(entry.path)
      .then((value) => {
        if (!active) return;
        if (value.identity !== entry.identity)
          throw new Error('This item was replaced. Close Get Info and select it again.');
        setOriginal(value);
        setDraft(value);
        setError('');
        setSaved(false);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entry.path, entry.identity, reload]);
  const changes = original && draft ? informationChanges(original, draft) : {};
  const dirty = Object.keys(changes).length > 0;
  const disabled = busy || loading || !draft?.canEdit;
  const change = (patch: Partial<Information>) => {
    setDraft((value) => value && { ...value, ...patch });
    setSaved(false);
  };
  const addTag = () => {
    const name = tagName.trim();
    if (!draft || !name || draft.tags.length >= 64) return;
    if (draft.tags.some((tag) => tag.name.normalize('NFC') === name.normalize('NFC'))) {
      setError('That tag is already on this item.');
      return;
    }
    if (/[\u0000-\u001f\u007f]/.test(name)) {
      setError('Use a tag name without control characters.');
      return;
    }
    change({ tags: [...draft.tags, { name, color: 0 }] });
    setTagName('');
    setError('');
  };
  return (
    <form
      className="information-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!original || !draft || !dirty || disabled) return;
        setBusy(true);
        setError('');
        setSaved(false);
        try {
          const value = await window.viewer.fileInformationUpdate(
            entry.path,
            original.revision,
            changes,
          );
          setOriginal(value);
          setDraft(value);
          setSaved(true);
        } catch (cause) {
          setError(errorMessage(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      {loading && (
        <p className="muted" role="status">
          Loading file information…
        </p>
      )}
      {draft && (
        <>
          <dl className="information-native-details">
            <div>
              <dt>{entry.directory ? 'Folder entry allocation' : 'Allocated size'}</dt>
              <dd>{formatBytes(draft.allocatedSize)}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{draft.owner}</dd>
            </div>
            <div>
              <dt>Group</dt>
              <dd>{draft.group}</dd>
            </div>
          </dl>
          <fieldset disabled={disabled} className="information-fields">
            <label className="information-lock">
              <input
                type="checkbox"
                checked={draft.locked}
                onChange={(event) => change({ locked: event.target.checked })}
              />
              Locked
            </label>
            <fieldset
              disabled={draft.locked || !draft.metadataSupported || !draft.metadataReadable}
            >
              <legend>Tags</legend>
              <div className="information-tags">
                {draft.tags.map((tag, index) => (
                  <div className="information-tag" key={index}>
                    <span className="information-tag-name">
                      <span className={'tag-dot tag-color-' + tag.color} aria-hidden="true" />
                      {tag.name}
                    </span>
                    <ChoiceButton
                      label={'Color for ' + tag.name}
                      value={String(tag.color)}
                      choices={tagColors.map((name, color) => ({
                        value: String(color),
                        label: name,
                      }))}
                      onChoose={(value) =>
                        change({
                          tags: draft.tags.map((item, i) =>
                            i === index ? { ...item, color: Number(value) } : item,
                          ),
                        })
                      }
                    />
                    <IconButton
                      icon="close"
                      label={'Remove tag ' + tag.name}
                      onClick={() => change({ tags: draft.tags.filter((_, i) => i !== index) })}
                    />
                  </div>
                ))}
                <div className="information-tag-add">
                  <input
                    aria-label="New tag name"
                    placeholder="Add a tag"
                    maxLength={80}
                    value={tagName}
                    disabled={draft.tags.length >= 64}
                    onChange={(event) => setTagName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        addTag();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={!tagName.trim() || draft.tags.length >= 64}
                    onClick={addTag}
                  >
                    Add
                  </button>
                </div>
              </div>
              <label className="field-label information-comment">
                Comments
                <textarea
                  rows={3}
                  maxLength={8192}
                  value={draft.comment}
                  onChange={(event) => change({ comment: event.target.value })}
                />
              </label>
            </fieldset>
            <details className="information-permissions">
              <summary>Permissions</summary>
              <fieldset disabled={draft.locked}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Who</th>
                      <th scope="col">Read</th>
                      <th scope="col">Write</th>
                      <th scope="col">{entry.directory ? 'Traverse' : 'Execute'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['Owner', 'Group', 'Everyone'].map((who, row) => (
                      <tr key={who}>
                        <th scope="row">{who}</th>
                        {[4, 2, 1].map((bit, column) => {
                          const mask = bit << ((2 - row) * 3);
                          return (
                            <td key={bit}>
                              <input
                                type="checkbox"
                                aria-label={
                                  who +
                                  ' ' +
                                  ['read', 'write', entry.directory ? 'traverse' : 'execute'][
                                    column
                                  ]
                                }
                                checked={!!(draft.mode & mask)}
                                onChange={(event) =>
                                  change({
                                    mode: event.target.checked
                                      ? draft.mode | mask
                                      : draft.mode & ~mask,
                                  })
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </fieldset>
            </details>
          </fieldset>
          {draft.readOnly ? (
            <p className="muted">This volume is read-only.</p>
          ) : !draft.canEdit ? (
            <p className="muted">Only the owner can edit this item's information.</p>
          ) : !draft.metadataSupported ? (
            <p className="muted">This filesystem does not support Finder tags or comments.</p>
          ) : !draft.metadataReadable ? (
            <p className="muted">Enable Read permission to view this item's tags and comments.</p>
          ) : null}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="information-save">
        {saved && (
          <span className="muted" role="status">
            Saved
          </span>
        )}
        {!saved && dirty && (
          <span className="muted" role="status">
            Unsaved changes
          </span>
        )}
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => setReload((value) => value + 1)}
        >
          Reload
        </button>
        {draft?.canEdit && (
          <button className="primary" disabled={disabled || !dirty}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>
    </form>
  );
}

function AdditionalInformation({ entry }: { entry: FileEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="information-additional"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Tags, comments and permissions</summary>
      {open && <InformationEditor entry={entry} />}
    </details>
  );
}
export function FileInformation({ entries, onClose }: { entries: FileEntry[]; onClose(): void }) {
  return (
    <Dialog title="File information" onClose={onClose}>
      <div className="file-information">
        {entries.map((entry) => (
          <section key={entry.path} aria-label={entry.name}>
            <dl>
              <dt>{entry.name}</dt>
              <dd>{entry.path}</dd>
              <dt>Kind</dt>
              <dd>
                {entry.kind === 'symlink'
                  ? 'Symbolic link'
                  : entry.directory
                    ? 'Folder'
                    : entry.mime}
              </dd>
              <dt>Size</dt>
              <dd>
                {entry.directory ? (
                  <SelectionSize entries={[entry]} />
                ) : (
                  `${formatBytes(entry.size)} (${entry.size.toLocaleString()} bytes)`
                )}
              </dd>
              <dt>Modified</dt>
              <dd>{entry.modified ? new Date(entry.modified).toLocaleString() : 'Unavailable'}</dd>
              <dt>Created</dt>
              <dd>{entry.created ? new Date(entry.created).toLocaleString() : 'Unavailable'}</dd>
              {entry.linkTarget && (
                <>
                  <dt>Target</dt>
                  <dd>{entry.linkTarget}</dd>
                </>
              )}
              {entry.error && <dd className="error">{entry.error}</dd>}
            </dl>
            {getState().bootstrap.platform === 'darwin' &&
              ['file', 'directory'].includes(entry.kind) &&
              (entries.length === 1 ? (
                <InformationEditor entry={entry} />
              ) : (
                <AdditionalInformation entry={entry} />
              ))}
          </section>
        ))}
      </div>
      <footer>
        {entries.some((entry) => entry.directory) && (
          <button
            onClick={() => {
              void calculateSize(entries).catch(report);
            }}
          >
            Calculate Size
          </button>
        )}
        {entries.length > 1 && <SelectionSize entries={entries} />}
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
