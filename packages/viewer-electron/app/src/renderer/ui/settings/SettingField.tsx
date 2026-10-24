import { useEffect, useState } from 'react';
export function Field({
  value,
  save,
  multiline = false,
  label,
  placeholder,
  list,
  readOnly,
}: {
  value: string;
  save(value: string): void;
  multiline?: boolean;
  label: string;
  placeholder?: string;
  list?: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    'aria-label': label,
    value: draft,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(event.target.value),
    onBlur: () => {
      if (draft !== value) save(draft);
    },
  };
  return multiline ? (
    <textarea {...props} rows={4} />
  ) : (
    <input
      {...props}
      list={list}
      readOnly={readOnly}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
