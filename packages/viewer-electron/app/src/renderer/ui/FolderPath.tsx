import './folder-path.css';

/** Keep the root and the final parent/name visible when a destination exceeds its row. */
export function FolderPath({ path }: { path: string }) {
  const parts = path.split('/');
  const tail = parts.length > 3 ? parts.slice(-2).join('/') : parts.at(-1)!;
  const start = path.slice(0, path.length - tail.length);
  return (
    <>
      <small className="folder-path" title={path} aria-hidden="true">
        <span>{start}</span>
        <span>{tail}</span>
      </small>
      <span className="visually-hidden">{path}</span>
    </>
  );
}
