import { receiveSessionKeys } from '../../keys/session';
import { ModelSettings } from '../models/ModelSettings';
import { FilePermissions } from '../permissions/FilePermissions';
import { PrivacyInformation } from './PrivacyInformation';
import type { SettingsChange } from './settings-edits';
import { SettingsEditQueue } from '../../settings/persistence/edit-queue';
import { failedFlush } from '../../../domain/persistence/flush';
import {
  TerminalSettings,
  CustomActionSettings,
  ConfigurationSettings,
  FolderOverrideSettings,
} from './AutomationSettings';
import { useEffect, useRef, useState } from 'react';
import type { SettingsSnapshot, SettingsPatch } from '../../../domain/services';
import { defaultSettings } from '../../../domain/services';
import { categories, settingCatalog } from '../../../domain/preferences/catalog';
import { normalizePreferences } from '../../../domain/preferences/ui';
import { Icon } from '../Icon';
import { Loading } from '../primitives';
import type { SettingsEditor } from './editor';
import { CatalogSettings } from './CatalogSettings';
import { NavigationSettings } from './NavigationSettings';
import { SearchSettings } from './SearchSettings';
import { RecipeSettings } from './RecipeSettings';
import { AgentSettings } from './AgentSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { ThemeSettings } from './ThemeSettings';
import type { CustomAction } from '../../../domain/automation/actions';
import { useTheme, useThemeVariables } from '../theme';
import { settingsDiscovery } from './discovery';

const noThemes = { themes: [], theme: { dark: '', light: '' } };
export function SettingsWindow() {
  const [commandDraft, setCommandDraft] = useState<CustomAction>();
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [category, setCategory] = useState('Browsing');
  const [query, setQuery] = useState('');
  // a setting's command opened Settings at it (2026-10-23): its category, the row shown and marked
  const [focused, setFocused] = useState<{ path: string; at: number } | null>(null);
  const show = (path: string) => {
    const section =
      path === 'settings.providers'
        ? 'Models'
        : path === 'settings.customActions'
          ? 'Actions'
          : undefined;
    if (section) {
      setQuery('');
      setCategory(section);
      setFocused(null);
      return;
    }
    const definition = settingCatalog.find((item) => item.path === path);
    if (!definition) return;
    setQuery('');
    setCategory(definition.category);
    setFocused({ path, at: Date.now() });
  };
  const [error, setError] = useState('');
  const latest = useRef<SettingsSnapshot | undefined>(undefined);
  const writes = useRef<SettingsEditQueue | null>(null);
  const accept = (value: SettingsSnapshot) => {
    if (latest.current && value.revision < latest.current.revision) return;
    latest.current = value;
    setSnapshot(value);
  };
  if (!writes.current)
    writes.current = new SettingsEditQueue({
      current: () => latest.current,
      write: (patches, revision) => window.viewer.settingsPatch(patches, revision),
      refresh: () => window.viewer.settingsGet(),
      accept,
      error: setError,
    });
  useEffect(() => {
    const readDraft = () => {
      void window.viewer
        .commandDraft?.()
        .then((draft) => {
          if (draft) setCommandDraft(draft);
        })
        .catch((error) => setError(error.message));
    };
    readDraft();
    void window.viewer
      .settingsGet()
      .then((value) => {
        accept(value);
        // the desktop passes the last category in, kept with the window's frame (2026-10-20)
        const saved = new URLSearchParams(window.location.search).get('category') ?? '';
        setCategory(
          categories.find((category) => category.toLowerCase() === saved.toLowerCase()) ||
            'Browsing',
        );
        const focus = new URLSearchParams(window.location.search).get('focus');
        if (focus) show(focus);
      })
      .catch((error) => setError(error.message));
    void window.viewer
      .sessionKeys?.()
      .then(receiveSessionKeys)
      .catch(() => {});
    return window.viewer.onEvent((event) => {
      if (event.type === 'service-error') setError(event.message);
      if (event.type === 'settings') accept(event.snapshot);
      else if (event.type === 'session-keys') receiveSessionKeys(event.session);
      if (event.type === 'settings-focus') {
        show(event.path);
        if (event.path === 'settings.customActions') readDraft();
      }
      if (event.type === 'flush-settings') {
        (document.activeElement as HTMLElement | null)?.blur();
        void writes
          .current!.flush()
          .then(
            () => window.viewer.flushed(event.token, { ok: true }),
            (error) => window.viewer.flushed(event.token, failedFlush(error)),
          )
          .catch((error) => setError((error as Error).message));
      }
    });
  }, []);
  useEffect(() => {
    if (!focused) return;
    const row = document.querySelector<HTMLElement>(
      `[data-setting-path="${CSS.escape(focused.path)}"]`,
    );
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
    row.classList.add('is-focused');
    const timer = setTimeout(() => row.classList.remove('is-focused'), 1600);
    return () => clearTimeout(timer);
    // the rows of the shown category, once drawn
  }, [focused, category, snapshot]);
  const look = snapshot?.look;
  // the theme's colours here too (2026-10-23)
  useThemeVariables(useTheme(snapshot?.settings ?? noThemes, look ?? 'dark'));
  useEffect(() => {
    if (look) {
      document.documentElement.dataset.look = look;
      document.documentElement.style.colorScheme = look;
    }
  }, [look]);
  const enqueue = (build: SettingsChange) => {
    setError('');
    writes.current!.enqueue(build);
  };
  const patch = (path: string, value: unknown) => enqueue(() => [{ path, value }]);
  const patches = (values: SettingsPatch[]) => enqueue(() => values);
  const selected = (value: string) => {
    setCategory(value);
    setQuery('');
    void window.viewer.settingsCategory(value.toLowerCase()).catch(() => {});
  };
  if (!snapshot)
    return (
      <div className="settings-window">
        {error ? <p role="alert">{error}</p> : <Loading label="Opening Settings…" />}
      </div>
    );
  const settings = snapshot.settings;
  const editor: SettingsEditor = { snapshot, patch, patches, save: enqueue, error: setError };
  const definitions = settingCatalog.filter((item) =>
    query
      ? (item.label + ' ' + item.category + ' ' + item.detail + ' ' + item.section)
          .toLowerCase()
          .includes(query.toLowerCase())
      : item.category === category,
  );
  const discover = settingsDiscovery(settings, query);
  const page = !query && category;
  return (
    <div className="settings-window">
      <aside className="settings-navigation">
        <div className="settings-search">
          <Icon name="search" size={16} />
          <input
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <nav aria-label="Settings categories">
          {categories.map((item) => (
            <button
              key={item}
              className={!query && category === item ? 'selected' : ''}
              onClick={() => selected(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>
      <main className="settings-page">
        <header>
          <h1>{query ? 'Search results' : category}</h1>
        </header>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        {query && !definitions.length && !discover.length && (
          <p className="settings-note">
            No settings match “{query}”. Use Actions, Models, or Agents to configure those services.
          </p>
        )}
        {query &&
          discover.map((item) => (
            <button
              className="settings-discovery"
              key={item.category}
              onClick={() => selected(item.category)}
            >
              Open {item.category.toLowerCase()} settings <Icon name="right" size={16} />
            </button>
          ))}
        {!query && category === 'Permissions' && <FilePermissions error={setError} />}
        {!query && category === 'Privacy' && <PrivacyInformation />}
        <CatalogSettings editor={editor} definitions={definitions} query={query} />
        {page === 'Navigation' && <NavigationSettings editor={editor} />}
        {page === 'Search' && <SearchSettings editor={editor} />}
        {!query && category === 'Models' && (
          <ModelSettings snapshot={snapshot} save={enqueue} error={setError} />
        )}
        {!query && category === 'Browsing' && (
          <FolderOverrideSettings snapshot={snapshot} save={patches} />
        )}
        {!query && category === 'Terminals' && (
          <TerminalSettings snapshot={snapshot} save={enqueue} />
        )}
        {!query && category === 'Configuration' && (
          <ConfigurationSettings snapshot={snapshot} save={patches} />
        )}
        {!query && category === 'Actions' && (
          <CustomActionSettings
            snapshot={snapshot}
            save={enqueue}
            draft={commandDraft}
            onDraftDone={() => setCommandDraft(undefined)}
          />
        )}
        {page === 'Actions' && <RecipeSettings editor={editor} />}
        {page === 'Agents' && <AgentSettings editor={editor} />}
        {page === 'Shortcuts' && <ShortcutSettings editor={editor} />}
        {page === 'Themes' && <ThemeSettings editor={editor} />}
        {!query && ['Browsing', 'Previews', 'Editor', 'Terminals', 'Space'].includes(category) && (
          <button
            className="settings-reset"
            onClick={() => {
              const defaults = defaultSettings(settings.search.roots[0] || '/');
              if (category === 'Space') patch('ui.space', normalizePreferences().space);
              else if (category === 'Previews') patch('settings.previews', defaults.previews);
              else if (category === 'Editor') patch('settings.editor', defaults.editor);
              // the font only: profiles and programs are the person's own
              else if (category === 'Terminals')
                patch('settings.terminalFont', defaults.terminalFont);
              else
                patches([
                  { path: 'settings.browsing', value: defaults.browsing },
                  { path: 'settings.appearance', value: defaults.appearance },
                  { path: 'ui.list', value: normalizePreferences().list },
                ]);
            }}
          >
            {category === 'Terminals'
              ? 'Reset terminal font'
              : `Reset ${category.toLowerCase()} defaults`}
          </button>
        )}
      </main>
    </div>
  );
}
