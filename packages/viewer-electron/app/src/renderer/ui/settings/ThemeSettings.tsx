import { useRef, useState } from 'react';
import {
  builtInTheme,
  shellTokens,
  syntaxTokens,
  terminalTokens,
  themeColor,
  type Theme,
} from '../../../domain/themes';
import { importItermColors, importVSCodeTheme } from '../../../domain/theme-import';
import { ChoiceButton } from '../ChoiceMenu';
import { Field } from '../SettingField';
import type { SettingsEditor } from './editor';

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
      .replace(/^-|-$/g, '') || 'theme'
  }-${Date.now().toString(36)}`;
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
        save={(text) => onChange(text.trim() ? (themeColor(text) ?? value) : undefined)}
      />
    </div>
  );
}
/**
 * THEMES (2026-10-23): a theme for each appearance; themes made new, imported from an iTerm colour
 * preset or a VS Code theme, edited colour by colour, renamed, copied as JSON or removed.
 */
export function ThemeSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch, error } = editor;
  const settings = snapshot.settings;
  const themes = settings.themes;
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const saveThemes = (next: Theme[]) => patch('settings.themes', next);
  const change = (id: string, update: (theme: Theme) => Theme) =>
    saveThemes(themes.map((theme) => (theme.id === id ? update(theme) : theme)));
  const changeMetrics = (id: string, metrics: Partial<NonNullable<Theme['metrics']>>) =>
    change(id, (theme) => ({ ...theme, metrics: { ...theme.metrics, ...metrics } }));
  const add = (theme: Theme, use = true) => {
    saveThemes([...themes, theme]);
    if (use) patch('settings.theme', { ...settings.theme, [theme.look]: theme.id });
    setOpen(theme.id);
  };
  const chooser = (look: 'dark' | 'light') => (
    <label className="settings-row">
      <span>{look === 'dark' ? 'Dark theme' : 'Light theme'}</span>
      <ChoiceButton
        label={look === 'dark' ? 'Dark theme' : 'Light theme'}
        value={settings.theme[look] || builtInTheme(look).id}
        choices={[builtInTheme(look), ...themes.filter((theme) => theme.look === look)].map(
          (theme) => ({ value: theme.id, label: theme.name }),
        )}
        onChoose={(id) =>
          patch('settings.theme', {
            ...settings.theme,
            [look]: id === builtInTheme(look).id ? '' : id,
          })
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
            const base = builtInTheme(snapshot.look);
            add({ ...structuredClone(base), id: newID('Custom'), name: `Custom ${base.name}` });
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
              add(
                chosen.name.endsWith('.itermcolors')
                  ? importItermColors(text, name)
                  : importVSCodeTheme(text, name),
              );
            } catch (failure) {
              error((failure as Error).message);
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
              <button
                onClick={() =>
                  add(
                    {
                      ...structuredClone(theme),
                      id: newID(theme.name),
                      name: `${theme.name} copy`,
                    },
                    false,
                  )
                }
              >
                Duplicate
              </button>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(JSON.stringify(theme, null, 2)).catch(() => {})
                }
              >
                Copy as JSON
              </button>
              <button
                onClick={() => {
                  saveThemes(themes.filter((item) => item.id !== theme.id));
                  if (settings.theme[theme.look] === theme.id)
                    patch('settings.theme', { ...settings.theme, [theme.look]: '' });
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
