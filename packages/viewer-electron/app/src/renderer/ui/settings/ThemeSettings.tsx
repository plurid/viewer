import { useRef, useState } from 'react';
import {
  builtInTheme,
  shellTokens,
  syntaxTokens,
  terminalTokens,
  themeColor,
  type Theme,
} from '../../../domain/preferences/themes';
import { importItermColors, importVSCodeTheme } from '../../../domain/preferences/theme-import';
import { ChoiceButton } from '../ChoiceMenu';
import { Field } from './SettingField';
import type { SettingsEditor } from './editor';
import type { SettingsPatch, SettingsSnapshot } from '../../../domain/services';
import type { Look } from '../../../domain/contracts';
import { errorMessage } from '../../../domain/errors';

const words: Record<string, string> = {
  space: 'Space',
  surface: 'Surfaces',
  raised: 'Raised',
  field: 'Fields',
  ink: 'Text',
  muted: 'Secondary text',
  subtle: 'Faint text',
  accent: 'Accent',
  line: 'Lines',
  selection: 'Selection',
  danger: 'Danger',
  comment: 'Comments',
  string: 'Strings',
  keyword: 'Keywords',
  number: 'Numbers',
  function: 'Functions',
  selectionBackground: 'Selection',
};
const tokenLabel = (token: string) =>
  words[token] ?? token.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
const groups = [
  ['shell', 'Interface', shellTokens],
  ['syntax', 'Code', syntaxTokens],
  ['terminal', 'Terminal', terminalTokens],
] as const;
const newID = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'theme'
  }-${crypto.randomUUID()}`;

/** Insertion and choosing the inserted theme are one revisioned edit. */
function appendTheme(snapshot: SettingsSnapshot, theme: Theme, use: boolean): SettingsPatch[] {
  return [
    { path: 'settings.themes', value: [...snapshot.settings.themes, theme] },
    ...(use
      ? [{ path: 'settings.theme', value: { ...snapshot.settings.theme, [theme.look]: theme.id } }]
      : []),
  ];
}
/** One colour of a theme: the system picker and its hex, the built-in colour where it has none. */
function ThemeColor({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange(value: string | undefined): void;
}) {
  const shown = value ?? fallback;
  return (
    <div className="theme-color">
      <span>{label}</span>
      <label className="theme-swatch" style={{ background: shown }} title={shown}>
        <input
          type="color"
          aria-label={label}
          value={shown.slice(0, 7)}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
      </label>
      <Field
        label={`${label} hex`}
        value={value ?? ''}
        placeholder={fallback}
        save={(text) => {
          const color = themeColor(text.trim());
          if (!text.trim() || color) onChange(color);
        }}
      />
    </div>
  );
}
/**
 * THEMES: a theme for each appearance; themes made new, imported from an iTerm colour
 * preset or a VS Code theme, edited colour by colour, renamed, copied as JSON or removed.
 */
export function ThemeSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, save, error } = editor;
  const settings = snapshot.settings;
  const themes = settings.themes;
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const change = (id: string, update: (theme: Theme) => Theme) =>
    save((current) => {
      if (!current.settings.themes.some((theme) => theme.id === id)) return [];
      return [
        {
          path: 'settings.themes',
          value: current.settings.themes.map((theme) => (theme.id === id ? update(theme) : theme)),
        },
      ];
    });
  const changeMetrics = (id: string, metrics: Partial<NonNullable<Theme['metrics']>>) =>
    change(id, (theme) => ({ ...theme, metrics: { ...theme.metrics, ...metrics } }));
  const add = (theme: Theme, use = true) => {
    save((current) => appendTheme(current, theme, use));
    setOpen(theme.id);
  };
  const duplicate = (theme: Theme) => {
    const id = newID(theme.name);
    save((current) => {
      const latest = current.settings.themes.find((item) => item.id === theme.id);
      return latest
        ? appendTheme(
            current,
            { ...structuredClone(latest), id, name: `${latest.name} copy` },
            false,
          )
        : [];
    });
    setOpen(id);
  };
  const chooser = (look: Look) => (
    <label className="settings-row">
      <span>{look === 'dark' ? 'Dark theme' : 'Light theme'}</span>
      <ChoiceButton
        label={look === 'dark' ? 'Dark theme' : 'Light theme'}
        value={settings.theme[look] || builtInTheme(look).id}
        choices={[builtInTheme(look), ...themes.filter((theme) => theme.look === look)].map(
          (theme) => ({ value: theme.id, label: theme.name }),
        )}
        onChoose={(id) =>
          save((current) => [
            {
              path: 'settings.theme',
              value: { ...current.settings.theme, [look]: id === builtInTheme(look).id ? '' : id },
            },
          ])
        }
      />
    </label>
  );
  return (
    <>
      {chooser('dark')}
      {chooser('light')}
      <div className="settings-actions">
        <button
          onClick={() => {
            const id = newID('Custom');
            save((current) => {
              const base = builtInTheme(current.look);
              return appendTheme(
                current,
                { ...structuredClone(base), id, name: `Custom ${base.name}` },
                true,
              );
            });
            setOpen(id);
          }}
        >
          New theme
        </button>
        <button onClick={() => file.current?.click()}>Import…</button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".itermcolors,.json,.jsonc"
          onChange={async (event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (!chosen) return;
            try {
              const text = await chosen.text();
              const name = chosen.name.replace(/\.[^.]+$/, '');
              const taken = themes.map((theme) => theme.id);
              add(
                chosen.name.endsWith('.itermcolors')
                  ? importItermColors(text, name, taken)
                  : importVSCodeTheme(text, name, taken),
              );
            } catch (failure) {
              error(errorMessage(failure));
            }
          }}
        />
      </div>
      {themes.map((theme) => {
        const base = builtInTheme(theme.look);
        return (
          <details
            key={theme.id}
            className="theme-editor"
            open={open === theme.id}
            onToggle={(event) => {
              if ((event.currentTarget as HTMLDetailsElement).open) setOpen(theme.id);
              else if (open === theme.id) setOpen(null);
            }}
          >
            <summary>
              {theme.name}
              <small>{theme.look === 'dark' ? 'Dark' : 'Light'}</small>
            </summary>
            <label className="settings-row">
              <span>Name</span>
              <Field
                label="Theme name"
                value={theme.name}
                save={(name) =>
                  name.trim() && change(theme.id, (item) => ({ ...item, name: name.trim() }))
                }
              />
            </label>
            <label className="settings-row">
              <span>Interface font</span>
              <Field
                label="Theme interface font"
                value={theme.metrics?.fontFamily ?? ''}
                placeholder="System font"
                save={(fontFamily) =>
                  changeMetrics(theme.id, { fontFamily: fontFamily.trim() || undefined })
                }
              />
            </label>
            <label className="settings-row">
              <span>Interface density</span>
              <ChoiceButton
                label="Theme interface density"
                value={theme.metrics?.density ?? 'comfortable'}
                choices={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
                onChoose={(density) =>
                  changeMetrics(theme.id, { density: density as 'compact' | 'comfortable' })
                }
              />
            </label>
            <label className="settings-row">
              <span>Corner radius</span>
              <input
                type="range"
                aria-label="Theme corner radius"
                min={0}
                max={16}
                value={theme.metrics?.radius ?? 5}
                onChange={(event) => {
                  const radius = Number(event.target.value);
                  changeMetrics(theme.id, { radius });
                }}
              />
            </label>
            {groups.map(([group, title, tokens]) => (
              <section key={group} className="theme-group">
                <h3>{title}</h3>
                {tokens.map((token) => (
                  <ThemeColor
                    key={token}
                    label={tokenLabel(token)}
                    value={(theme[group] as Record<string, string | undefined>)[token]}
                    fallback={(base[group] as Record<string, string>)[token] ?? '#000000'}
                    onChange={(value) =>
                      change(theme.id, (item) => {
                        const colors = { ...(item[group] as Record<string, string>) };
                        if (value) colors[token] = value;
                        else delete colors[token];
                        return { ...item, [group]: colors };
                      })
                    }
                  />
                ))}
              </section>
            ))}
            <div className="settings-actions">
              <button onClick={() => duplicate(theme)}>Duplicate</button>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(JSON.stringify(theme, null, 2)).catch(() => {})
                }
              >
                Copy as JSON
              </button>
              <button
                onClick={() => {
                  save((current) => {
                    const selected = { ...current.settings.theme };
                    for (const look of ['dark', 'light'] as const)
                      if (selected[look] === theme.id) selected[look] = '';
                    return [
                      {
                        path: 'settings.themes',
                        value: current.settings.themes.filter((item) => item.id !== theme.id),
                      },
                      { path: 'settings.theme', value: selected },
                    ];
                  });
                }}
              >
                Remove
              </button>
            </div>
          </details>
        );
      })}
    </>
  );
}
