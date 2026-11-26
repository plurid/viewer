import { receiveSessionKeys } from '../../keys/session';
import { useConfirmation } from './ConfirmAction';
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
import { LicenseSettings } from './LicenseSettings';
import type { LicenseStatus } from '../../../domain/license/license';
import { SearchSettings } from './SearchSettings';
import { RecipeSettings } from './RecipeSettings';
import { AgentSettings } from './AgentSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { ThemeSettings } from './ThemeSettings';
import type { CustomAction } from '../../../domain/automation/actions';
import { useTheme, useThemeVariables } from '../theme';
import { settingsDiscovery } from './discovery';
import { SpeechSettings } from '../../speech/SpeechSettings';
import { resolvedShortcut } from '../../../domain/preferences/shortcuts';
import { errorMessage } from '../../../domain/errors';
import { PathHome } from '../PathLabel';

const noThemes = { themes: [], theme: { dark: '', light: '' } };
export function SettingsWindow() {
  const [commandDraft, setCommandDraft] = useState<CustomAction>();
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [license, setLicense] = useState<LicenseStatus>();
  const [category, setCategory] = useState('Browsing');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  // a setting's command opened Settings at it: its category, the row shown and marked
  const [focused, setFocused] = useState<{ path: string; at: number } | null>(null);
  const show = (path: string) => {
    const section =
      path === 'license'
        ? 'License'
        : path === 'settings.providers'
          ? 'Models'
          : path === 'settings.speech'
            ? 'Speech'
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
  // the one setting a write was for, so a refused value's reason shows beside its row
  const [errorPath, setErrorPath] = useState<string>();
  const writingPath = useRef<string | undefined>(undefined);
  const confirmation = useConfirmation();
  const latest = useRef<SettingsSnapshot | undefined>(undefined);
  const flushColors = useRef<() => void>(null);
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
      error: (message) => {
        setError(message);
        setErrorPath(writingPath.current);
      },
    });
  useEffect(() => {
    let live = true;
    let licenseReceived = false;
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
        // the desktop passes the last category in, kept with the window's frame
        const saved = new URLSearchParams(window.location.search).get('category') ?? '';
        setCategory(
          [...categories, 'License'].find(
            (category) => category.toLowerCase() === saved.toLowerCase(),
          ) || 'Browsing',
        );
        const focus = new URLSearchParams(window.location.search).get('focus');
        if (focus) show(focus);
        else setSearchFocusRequest((request) => request + 1);
      })
      .catch((error) => setError(error.message));
    void window.viewer
      .license({ kind: 'status' })
      .then((value) => {
        if (live && !licenseReceived) setLicense(value);
      })
      .catch((failure) => {
        if (live) setError(errorMessage(failure));
      });
    void window.viewer
      .sessionKeys?.()
      .then(receiveSessionKeys)
      .catch(() => {});
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'service-error') setError(event.message);
      if (event.type === 'settings') accept(event.snapshot);
      else if (event.type === 'license') {
        licenseReceived = true;
        setLicense(event.status);
      } else if (event.type === 'session-keys') receiveSessionKeys(event.session);
      if (event.type === 'settings-focus') {
        if (event.path) show(event.path);
        else {
          setFocused(null);
          setSearchFocusRequest((request) => request + 1);
        }
        if (event.path === 'settings.customActions') readDraft();
      }
      if (event.type === 'flush-settings') {
        (document.activeElement as HTMLElement | null)?.blur();
        flushColors.current?.();
        void writes
          .current!.flush()
          .then(
            () => window.viewer.flushed(event.token, { ok: true }),
            (error) => window.viewer.flushed(event.token, failedFlush(error)),
          )
          .catch((error) => setError(errorMessage(error)));
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  const ready = !!snapshot;
  useEffect(() => {
    if (!ready || !searchFocusRequest) return;
    search.current?.focus({ preventScroll: true });
    search.current?.select();
  }, [ready, searchFocusRequest]);
  const appliedFocus = useRef<typeof focused>(null);
  useEffect(() => {
    if (!focused || appliedFocus.current === focused) return;
    const row = document.querySelector<HTMLElement>(
      `[data-setting-path="${CSS.escape(focused.path)}"]`,
    );
    if (!row) return;
    appliedFocus.current = focused;
    row.scrollIntoView({ block: 'center' });
    row.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
    row.classList.add('is-focused');
    const timer = setTimeout(() => row.classList.remove('is-focused'), 1600);
    return () => clearTimeout(timer);
    // the rows of the shown category, once drawn
  }, [focused, category, snapshot]);
  const look = snapshot?.look;
  // the theme's colours here too
  useThemeVariables(useTheme(snapshot?.settings ?? noThemes, look ?? 'dark'));
  useEffect(() => {
    if (look) {
      document.documentElement.dataset.look = look;
      document.documentElement.style.colorScheme = look;
    }
  }, [look]);
  const scrollbars = snapshot?.settings.browsing.scrollbars ?? 'system';
  useEffect(() => {
    document.documentElement.dataset.scrollbars = scrollbars;
  }, [scrollbars]);
  const enqueue = (build: SettingsChange, path?: string) => {
    setError('');
    setErrorPath(undefined);
    writingPath.current = path;
    writes.current!.enqueue(build);
  };
  const patch = (path: string, value: unknown) => enqueue(() => [{ path, value }], path);
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
  const failure = error && errorPath ? { path: errorPath, message: error } : undefined;
  const editor: SettingsEditor = {
    snapshot,
    patch,
    patches,
    save: (change) => enqueue(change),
    error: setError,
    failure,
  };
  const shownCategory = category === 'License' && !license ? 'Browsing' : category;
  const definitions = settingCatalog.filter((item) =>
    query
      ? (item.label + ' ' + item.category + ' ' + item.detail + ' ' + item.section)
          .toLowerCase()
          .includes(query.toLowerCase())
      : item.category === shownCategory,
  );
  const discover = settingsDiscovery(settings, query);
  // a failure that a catalog row on this page shows beside itself needs no banner
  const rowShowsError = !!failure && definitions.some((item) => item.path === failure.path);
  const page = !query && shownCategory;
  return (
    <PathHome.Provider value={snapshot.home ?? ''}>
      <div className="settings-window">
        <aside className="settings-navigation">
          <div className="settings-search">
            <Icon name="search" size={16} />
            <input
              ref={search}
              aria-label="Search settings"
              placeholder="Search settings"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <nav aria-label="Settings categories">
            {(license ? [...categories, 'License'] : categories).map((item) => (
              <button
                key={item}
                className={!query && shownCategory === item ? 'selected' : ''}
                onClick={() => selected(item)}
              >
                {item}
              </button>
            ))}
          </nav>
        </aside>
        <main className="settings-page" key={query ? 'search' : category}>
          <header>
            <h1>{query ? 'Search results' : shownCategory}</h1>
          </header>
          {error && !rowShowsError && (
            <p className="settings-error" role="alert">
              {error}
            </p>
          )}
          {query && !definitions.length && !discover.length && (
            <p className="settings-note">
              No settings match “{query}”. Actions, Models and Agents set up their services on their
              own pages.
            </p>
          )}
          {query &&
            discover.map((item) => (
              <button
                className="settings-discovery"
                key={item.category}
                onClick={() => selected(item.category)}
              >
                Open {item.category} Settings <Icon name="right" size={16} />
              </button>
            ))}
          {!query && category === 'Permissions' && <FilePermissions error={setError} />}
          {!query && category === 'Privacy' && <PrivacyInformation showLicense={!!license} />}
          <CatalogSettings
            key={category}
            flushRef={flushColors}
            editor={editor}
            definitions={definitions}
            query={query}
          />
          {page === 'Navigation' && <NavigationSettings editor={editor} />}
          {page === 'License' && license && (
            <LicenseSettings status={license} onChange={setLicense} />
          )}
          {page === 'Search' && <SearchSettings editor={editor} />}
          {!query && category === 'Models' && (
            <ModelSettings snapshot={snapshot} save={enqueue} error={setError} />
          )}
          {page === 'Speech' && <SpeechSettings shortcut={resolvedShortcut(settings, 'dictate')} />}
          {page === 'Browsing' && <FolderOverrideSettings snapshot={snapshot} save={patches} />}
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
          {!query &&
            ['Browsing', 'Previews', 'Editor', 'Terminals', 'Space'].includes(category) && (
              <button
                className="settings-reset danger"
                onClick={() =>
                  confirmation.ask({
                    title:
                      category === 'Terminals'
                        ? 'Reset the terminal font?'
                        : `Reset the ${category} settings?`,
                    detail:
                      category === 'Browsing'
                        ? 'Every Browsing setting, the appearance and the list columns go back to their defaults.'
                        : category === 'Terminals'
                          ? 'The terminal font and its size go back to their defaults. Profiles and programs stay.'
                          : `Every ${category} setting goes back to its default.`,
                    action: 'Reset',
                    run: () => {
                      const defaults = defaultSettings(snapshot.home || '/');
                      if (category === 'Space') patch('ui.space', normalizePreferences().space);
                      else if (category === 'Previews')
                        patch('settings.previews', defaults.previews);
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
                    },
                  })
                }
              >
                {category === 'Terminals' ? 'Reset Terminal Font' : `Reset ${category} Defaults`}
              </button>
            )}
          {confirmation.dialog}
        </main>
      </div>
    </PathHome.Provider>
  );
}
