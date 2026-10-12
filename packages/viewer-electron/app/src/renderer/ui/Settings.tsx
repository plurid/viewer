import { AgentGrants } from './AgentGrants';
import { Field } from './SettingField';
import { saveSettingsChange, type SettingsChange } from './settings-edits';
import { defaultShortcuts } from '../../domain/shortcuts';
import {
  TerminalSettings,
  CustomActionSettings,
  ConfigurationSettings,
  FolderOverrideSettings,
} from './AutomationSettings';
import { Fragment, useEffect, useRef, useState } from 'react';
import type {
  ActionRecipe,
  ModelProvider,
  SettingsSnapshot,
  IndexStatus,
  SettingsPatch,
} from '../../domain/services';
import { builtInRecipes, defaultSettings } from '../../domain/services';
import { categories, settingCatalog, settingValue } from '../../domain/setting-catalog';
import { normalizePreferences } from '../../domain/preferences';
import { Icon } from './Icon';
import { IconButton, Loading } from './primitives';
export function SettingsWindow() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [category, setCategory] = useState('Browsing');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [index, setIndex] = useState<IndexStatus>();
  const [agentConfig, setAgentConfig] = useState('');
  const [models, setModels] = useState<Record<string, string[]>>({});
  const latest = useRef<SettingsSnapshot | undefined>(undefined);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const accept = (value: SettingsSnapshot) => {
    if (latest.current && value.revision < latest.current.revision) return;
    latest.current = value;
    setSnapshot(value);
  };
  useEffect(() => {
    void window.viewer
      .settingsGet()
      .then((value) => {
        accept(value);
        const saved = value.settings.settingsWindow.category;
        setCategory(
          categories.find((category) => category.toLowerCase() === saved.toLowerCase()) ||
            'Browsing',
        );
      })
      .catch((error) => setError(error.message));
    void window.viewer
      .indexStatus()
      .then(setIndex)
      .catch((error) => setError(error.message));
    return window.viewer.onEvent((event) => {
      if (event.type === 'service-error') setError(event.message);
      if (event.type === 'settings') accept(event.snapshot);
      if (event.type === 'index') setIndex(event.status);
      if (event.type === 'flush-settings') {
        (document.activeElement as HTMLElement | null)?.blur();
        void writes.current
          .then(() => window.viewer.flushed(event.token))
          .catch((error) => setError((error as Error).message));
      }
    });
  }, []);
  useEffect(() => {
    if (snapshot) {
      document.documentElement.dataset.look = snapshot.look;
      document.documentElement.style.colorScheme = snapshot.look;
    }
  }, [snapshot?.look]);
  const enqueue = (build: SettingsChange) => {
    setError('');
    writes.current = saveSettingsChange(
      writes.current,
      {
        current: () => latest.current,
        write: (patches, revision) => window.viewer.settingsPatch(patches, revision),
        refresh: () => window.viewer.settingsGet(),
        accept,
        error: setError,
      },
      build,
    );
  };
  const patch = (path: string, value: unknown) => enqueue(() => [{ path, value }]);
  const patches = (values: SettingsPatch[]) => enqueue(() => values);
  const chooseNewPlaneFolder = () => {
    void window.viewer
      .chooseFolder()
      .then((path) => {
        if (path)
          patches([
            { path: 'settings.browsing.newPlanePath', value: path },
            { path: 'settings.browsing.newPlaneLocation', value: 'custom' },
          ]);
      })
      .catch((error) => setError((error as Error).message));
  };
  const selected = (value: string) => {
    setCategory(value);
    setQuery('');
    patch('settings.settingsWindow.category', value.toLowerCase());
  };
  if (!snapshot)
    return (
      <div className="settings-window">
        {error ? <p role="alert">{error}</p> : <Loading label="Opening Settings…" />}
      </div>
    );
  const settings = snapshot.settings;
  const definitions = settingCatalog.filter((item) =>
    query
      ? (item.label + ' ' + item.category + ' ' + item.detail + ' ' + item.section)
          .toLowerCase()
          .includes(query.toLowerCase())
      : item.category === category,
  );
  const providerPatch = (id: string, values: Partial<ModelProvider>) =>
    enqueue((current) => [
      {
        path: 'settings.providers',
        value: current.settings.providers.map((provider) =>
          provider.id === id ? { ...provider, ...values } : provider,
        ),
      },
    ]);
  const discover = [
    {
      category: 'Search',
      terms: 'indexed locations exclusions content indexing saved searches offline drives',
    },
    {
      category: 'Actions',
      terms:
        'recipes rename template year author title publisher book pdf epub instructions import export ' +
        settings.recipes.map((recipe) => recipe.name).join(' '),
    },
    {
      category: 'Models',
      terms:
        'api key credentials provider endpoint openai anthropic local model ' +
        settings.providers.map((provider) => provider.name + ' ' + provider.model).join(' '),
    },
    {
      category: 'Agents',
      terms: 'mcp token client authorization folders scope agent configuration',
    },
    { category: 'Terminals', terms: 'shell profiles environment tmux iterm external terminal' },
    { category: 'Configuration', terms: 'jsonc config file validate changes import export reset' },
    { category: 'Shortcuts', terms: 'keyboard hotkeys commands bindings' },
  ].filter((item) => query && item.terms.toLowerCase().includes(query.toLowerCase()));
  const recipePatch = (id: string, values: Partial<ActionRecipe>) =>
    enqueue((current) => [
      {
        path: 'settings.recipes',
        value: current.settings.recipes.map((recipe) =>
          recipe.id === id ? { ...recipe, ...values } : recipe,
        ),
      },
    ]);
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
        <div className="settings-group">
          {definitions.map((definition, index) => (
            <Fragment key={definition.path}>
              {definition.section && definition.section !== definitions[index - 1]?.section && (
                <h2>{definition.section}</h2>
              )}
              <label className="settings-row">
                <span>
                  {definition.label}
                  {definition.detail && <small>{definition.detail}</small>}
                  {query && <small>{definition.category}</small>}
                </span>
                {definition.kind === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={settingValue(snapshot, definition.path) === true}
                    onChange={(event) => patch(definition.path, event.target.checked)}
                  />
                ) : definition.kind === 'choice' ? (
                  <select
                    aria-label={definition.label}
                    value={String(settingValue(snapshot, definition.path))}
                    onChange={(event) => {
                      if (
                        definition.path === 'settings.browsing.newPlaneLocation' &&
                        event.target.value === 'custom'
                      ) {
                        chooseNewPlaneFolder();
                        return;
                      }
                      patch(
                        definition.path,
                        definition.path === 'settings.previews.thumbnailSize'
                          ? Number(event.target.value)
                          : event.target.value,
                      );
                    }}
                  >
                    {definition.choices?.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={definition.label}
                    type="number"
                    min={definition.min}
                    max={definition.max}
                    defaultValue={Number(settingValue(snapshot, definition.path))}
                    onBlur={(event) => patch(definition.path, Number(event.target.value))}
                  />
                )}
              </label>
              {definition.path === 'settings.browsing.newPlaneLocation' &&
                settings.browsing.newPlaneLocation === 'custom' && (
                  <div className="settings-folder-choice">
                    <span title={settings.browsing.newPlanePath}>
                      {settings.browsing.newPlanePath}
                    </span>
                    <button onClick={chooseNewPlaneFolder}>Change folder…</button>
                  </div>
                )}
            </Fragment>
          ))}
        </div>
        {!query && category === 'Navigation' && (
          <>
            <h2>Sidebar sections</h2>
            {snapshot.ui.sidebar.order.map((section) => (
              <label className="settings-row" key={section}>
                <span>{section[0].toUpperCase() + section.slice(1)}</span>
                <input
                  type="checkbox"
                  checked={!snapshot.ui.sidebar.collapsed.includes(section)}
                  onChange={(event) =>
                    patch(
                      'ui.sidebar.collapsed',
                      event.target.checked
                        ? snapshot.ui.sidebar.collapsed.filter((item) => item !== section)
                        : [...snapshot.ui.sidebar.collapsed, section],
                    )
                  }
                />
              </label>
            ))}
            <p className="settings-note">
              Drag section headings and shortcuts in any sidebar to change their order.
            </p>
            <button onClick={() => patch('ui.sidebar', normalizePreferences().sidebar)}>
              Reset navigation defaults
            </button>
          </>
        )}
        {!query && category === 'Search' && (
          <>
            <h2>Indexed locations</h2>
            {settings.search.roots.map((root) => {
              const status = index?.roots.find((item) => item.path === root);
              return (
                <div className="settings-location" key={root}>
                  <span title={root}>
                    {root}
                    <small>
                      {status
                        ? status.status +
                          ' · ' +
                          status.count.toLocaleString() +
                          ' files' +
                          (status.errors ? ' · ' + status.errors + ' unavailable' : '')
                        : 'Waiting to index'}
                    </small>
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.search.contentRoots.includes(root)}
                      onChange={(event) =>
                        patch(
                          'settings.search.contentRoots',
                          event.target.checked
                            ? [...settings.search.contentRoots, root]
                            : settings.search.contentRoots.filter((item) => item !== root),
                        )
                      }
                    />{' '}
                    Contents
                  </label>
                  <IconButton
                    icon="close"
                    label="Remove indexed location"
                    onClick={() =>
                      patches([
                        {
                          path: 'settings.search.roots',
                          value: settings.search.roots.filter((item) => item !== root),
                        },
                        {
                          path: 'settings.search.contentRoots',
                          value: settings.search.contentRoots.filter((item) => item !== root),
                        },
                      ])
                    }
                  />
                </div>
              );
            })}
            <div className="settings-actions">
              <button
                onClick={() => {
                  void window.viewer
                    .chooseFolder()
                    .then((root) => {
                      if (root && !settings.search.roots.includes(root))
                        patch('settings.search.roots', [...settings.search.roots, root]);
                    })
                    .catch((error) => setError(error.message));
                }}
              >
                Add location…
              </button>
              <button
                onClick={() => {
                  void window.viewer.indexRebuild().catch((error) => setError(error.message));
                }}
              >
                Rebuild index
              </button>
            </div>
            <h2>Saved searches</h2>
            {settings.savedSearches.map((search) => (
              <div className="settings-location" key={search.id}>
                <span>
                  {search.name}
                  <small>
                    {search.query} · {search.root || 'Indexed locations'}
                  </small>
                </span>
                <IconButton
                  icon="close"
                  label={'Remove saved search ' + search.name}
                  onClick={() =>
                    patch(
                      'settings.savedSearches',
                      settings.savedSearches.filter((item) => item.id !== search.id),
                    )
                  }
                />
              </div>
            ))}
            <h2>Excluded names and paths</h2>
            <Field
              multiline
              label="Index exclusions"
              value={settings.search.exclusions.join('\n')}
              save={(value) =>
                patch(
                  'settings.search.exclusions',
                  value
                    .split('\n')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
            <p className="settings-note">
              Filenames and metadata are indexed locally. Content indexing reads supported documents
              only in the locations you enable. Offline drives retain their last results.
            </p>
          </>
        )}
        {!query && category === 'Models' && (
          <>
            <p className="settings-note">
              Choose a provider and model for each recipe. Requests run only when you invoke an
              action.
            </p>
            {settings.providers.map((provider) => (
              <section className="settings-editor" key={provider.id}>
                <div className="settings-editor-heading">
                  <h2>{provider.name}</h2>
                  <IconButton
                    icon="close"
                    label="Remove provider"
                    onClick={() =>
                      patch(
                        'settings.providers',
                        settings.providers.filter((item) => item.id !== provider.id),
                      )
                    }
                  />
                </div>
                <label>
                  Name
                  <Field
                    label="Provider name"
                    value={provider.name}
                    save={(name) => providerPatch(provider.id, { name })}
                  />
                </label>
                <label>
                  Endpoint
                  <Field
                    label="Provider endpoint"
                    value={provider.endpoint}
                    save={(endpoint) => providerPatch(provider.id, { endpoint })}
                  />
                </label>
                <label>
                  Model
                  <input
                    list={'models-' + provider.id}
                    aria-label="Model"
                    defaultValue={provider.model}
                    onBlur={(event) => providerPatch(provider.id, { model: event.target.value })}
                  />
                  <datalist id={'models-' + provider.id}>
                    {models[provider.id]?.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>
                <label>
                  API key
                  <input
                    type="password"
                    aria-label="API key"
                    autoComplete="off"
                    placeholder={
                      snapshot.credentials.includes(provider.id)
                        ? 'Stored securely'
                        : 'Optional for local servers'
                    }
                    onBlur={(event) => {
                      const key = event.target.value;
                      if (key) {
                        event.target.value = '';
                        void window.viewer
                          .providerCredential(provider.id, key)
                          .catch((error) => setError(error.message));
                      }
                    }}
                  />
                </label>
                <label className="settings-row">
                  <span>
                    Allow document excerpts and text
                    <small>Each recipe also controls what it sends.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={provider.allowContent}
                    onChange={(event) =>
                      providerPatch(provider.id, { allowContent: event.target.checked })
                    }
                  />
                </label>
                {snapshot.credentials.includes(provider.id) && (
                  <button
                    onClick={() => {
                      void window.viewer
                        .providerCredential(provider.id, '')
                        .catch((error) => setError(error.message));
                    }}
                  >
                    Clear stored key
                  </button>
                )}
                <button
                  onClick={() => {
                    setError('');
                    void window.viewer
                      .providerModels(provider.id)
                      .then((values) => {
                        setModels((old) => ({ ...old, [provider.id]: values }));
                        if (!values.length)
                          setError(
                            'Connected, but the server returned no model IDs. Enter its model name manually.',
                          );
                      })
                      .catch((error) => setError(error.message));
                  }}
                >
                  Connect and load models
                </button>
              </section>
            ))}
            <div className="settings-actions">
              {(['openai', 'anthropic', 'local'] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() =>
                    patch('settings.providers', [
                      ...settings.providers,
                      {
                        id: crypto.randomUUID(),
                        name:
                          kind === 'openai'
                            ? 'OpenAI'
                            : kind === 'anthropic'
                              ? 'Anthropic'
                              : 'Local endpoint',
                        kind,
                        endpoint:
                          kind === 'openai'
                            ? 'https://api.openai.com/v1'
                            : kind === 'anthropic'
                              ? 'https://api.anthropic.com/v1'
                              : 'http://localhost:11434/v1',
                        model: '',
                        allowContent: false,
                      },
                    ])
                  }
                >
                  Add{' '}
                  {kind === 'openai'
                    ? 'OpenAI'
                    : kind === 'anthropic'
                      ? 'Anthropic'
                      : 'local endpoint'}
                </button>
              ))}
            </div>
          </>
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
          <CustomActionSettings snapshot={snapshot} save={enqueue} />
        )}
        {!query && category === 'Actions' && (
          <>
            <p className="settings-note">
              Recipes appear in Commands and file actions. Every file-change proposal opens for
              review.
            </p>
            {settings.recipes.map((recipe) => (
              <details className="settings-recipe" key={recipe.id}>
                <summary>
                  {recipe.name}
                  <small>{recipe.kind}</small>
                </summary>
                <div className="settings-editor">
                  <label>
                    Name
                    <Field
                      label="Recipe name"
                      value={recipe.name}
                      save={(name) => recipePatch(recipe.id, { name })}
                    />
                  </label>
                  <label>
                    Action type
                    <select
                      value={recipe.kind}
                      onChange={(event) =>
                        recipePatch(recipe.id, {
                          kind: event.target.value as ActionRecipe['kind'],
                          template:
                            builtInRecipes.find((item) => item.kind === event.target.value)
                              ?.template || '',
                        })
                      }
                    >
                      {builtInRecipes.map((item) => (
                        <option key={item.kind} value={item.kind}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Formats
                    <Field
                      label="Recipe formats"
                      placeholder="Empty means all files"
                      value={recipe.formats.join(', ')}
                      save={(value) =>
                        recipePatch(recipe.id, {
                          formats: value
                            .split(',')
                            .map((value) => value.trim().replace(/^\./, '').toLowerCase())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label className="settings-row">
                    <span>Include subfolders</span>
                    <input
                      type="checkbox"
                      checked={recipe.recursive}
                      onChange={(event) =>
                        recipePatch(recipe.id, { recursive: event.target.checked })
                      }
                    />
                  </label>
                  {['book-name', 'batch-rename'].includes(recipe.kind) && (
                    <label>
                      Filename template
                      <Field
                        label="Filename template"
                        value={recipe.template}
                        save={(template) => recipePatch(recipe.id, { template })}
                      />
                    </label>
                  )}
                  <label>
                    Instructions
                    <Field
                      multiline
                      label="Recipe instructions"
                      value={recipe.instructions}
                      save={(instructions) => recipePatch(recipe.id, { instructions })}
                    />
                  </label>
                  <label>
                    Model provider
                    <select
                      value={recipe.providerID || ''}
                      onChange={(event) =>
                        recipePatch(recipe.id, { providerID: event.target.value || undefined })
                      }
                    >
                      <option value="">Local metadata / no model</option>
                      {settings.providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name} · {provider.model || 'Choose model'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Permitted data
                    <select
                      value={recipe.data}
                      onChange={(event) =>
                        recipePatch(recipe.id, { data: event.target.value as ActionRecipe['data'] })
                      }
                    >
                      <option value="names">Filenames only</option>
                      <option value="excerpts">Metadata and excerpts</option>
                      <option value="full-text">Extracted text</option>
                    </select>
                  </label>
                  <label>
                    Shortcut
                    <Field
                      label="Recipe shortcut"
                      value={recipe.shortcut || ''}
                      placeholder="Cmd+Shift+R"
                      save={(shortcut) =>
                        recipePatch(recipe.id, { shortcut: shortcut || undefined })
                      }
                    />
                  </label>
                  <div className="settings-actions">
                    <button
                      onClick={() =>
                        patch('settings.recipes', [
                          ...settings.recipes,
                          {
                            ...recipe,
                            id: crypto.randomUUID(),
                            name: recipe.name + ' copy',
                            shortcut: undefined,
                          },
                        ])
                      }
                    >
                      Duplicate recipe
                    </button>
                    {!builtInRecipes.some((item) => item.id === recipe.id) && (
                      <button
                        onClick={() =>
                          patch(
                            'settings.recipes',
                            settings.recipes.filter((item) => item.id !== recipe.id),
                          )
                        }
                      >
                        Remove recipe
                      </button>
                    )}
                  </div>
                </div>
              </details>
            ))}
            <div className="settings-actions">
              <button
                onClick={() =>
                  patch('settings.recipes', [
                    ...settings.recipes,
                    { ...builtInRecipes[2], id: crypto.randomUUID(), name: 'New action' },
                  ])
                }
              >
                New recipe
              </button>
              <button
                onClick={() => {
                  const data = JSON.stringify(settings.recipes, null, 2);
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'viewer-recipes.json';
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export recipes
              </button>
              <label className="button-label">
                Import recipes
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void file
                        .text()
                        .then((text) => {
                          const value: unknown = JSON.parse(text);
                          if (!Array.isArray(value)) throw new Error('Choose a recipe JSON array.');
                          patch('settings.recipes', [...settings.recipes, ...value]);
                        })
                        .catch((error) => setError(error.message));
                  }}
                />
              </label>
            </div>
          </>
        )}
        {!query && category === 'Agents' && <AgentGrants settings={settings} />}
        {!query && category === 'Agents' && (
          <>
            <p className="settings-note">
              Local MCP clients can inspect authorized folders and propose tasks. File changes
              require your review in this app.
            </p>
            <h2>Authorized folders</h2>
            {settings.agents.roots.map((root) => (
              <div className="settings-location" key={root}>
                <span>{root}</span>
                <IconButton
                  icon="close"
                  label="Remove agent folder access"
                  onClick={() =>
                    patch(
                      'settings.agents.roots',
                      settings.agents.roots.filter((item) => item !== root),
                    )
                  }
                />
              </div>
            ))}
            <button
              onClick={() => {
                void window.viewer
                  .chooseFolder()
                  .then((root) => {
                    if (root && !settings.agents.roots.includes(root))
                      patch('settings.agents.roots', [...settings.agents.roots, root]);
                  })
                  .catch((error) => setError(error.message));
              }}
            >
              Authorize folder…
            </button>
            <h2>Connect a client</h2>
            <p className="settings-note">
              Keep Viewer open for proposal review. Regenerating the token disconnects previous
              credentials.
            </p>
            <button
              disabled={!settings.agents.enabled || !settings.agents.roots.length}
              onClick={() => {
                void window.viewer
                  .agentToken()
                  .then(setAgentConfig)
                  .catch((error) => setError(error.message));
              }}
            >
              Generate MCP configuration
            </button>
            {agentConfig && (
              <textarea
                className="agent-configuration"
                aria-label="MCP configuration"
                readOnly
                rows={10}
                value={agentConfig}
                onFocus={(event) => event.target.select()}
              />
            )}
          </>
        )}
        {!query && category === 'Shortcuts' && (
          <>
            <p className="settings-note">
              Recipe shortcuts are configured in Actions. Use Cmd, Ctrl, Alt, Shift, and a key.
              Space remains quick preview.
            </p>
            {Object.entries(defaultShortcuts)
              .map(([id, shortcut]) => [id, id.replaceAll('-', ' '), shortcut])
              .map(([id, label, shortcut]) => (
                <label className="settings-row" key={id}>
                  <span>{label}</span>
                  <Field
                    label={label + ' shortcut'}
                    value={settings.shortcuts[id] ?? shortcut}
                    save={(value) =>
                      patch('settings.shortcuts', { ...settings.shortcuts, [id]: value })
                    }
                  />
                </label>
              ))}
            <button onClick={() => patch('settings.shortcuts', {})}>
              Reset keyboard shortcuts
            </button>
          </>
        )}
        {!query && ['Browsing', 'Previews', 'Space'].includes(category) && (
          <button
            className="settings-reset"
            onClick={() => {
              const defaults = defaultSettings(settings.search.roots[0] || '/');
              if (category === 'Space') patch('ui.space', normalizePreferences().space);
              else if (category === 'Previews') patch('settings.previews', defaults.previews);
              else
                patches([
                  { path: 'settings.browsing', value: defaults.browsing },
                  { path: 'settings.appearance', value: defaults.appearance },
                  { path: 'ui.list', value: normalizePreferences().list },
                ]);
            }}
          >
            Reset {category.toLowerCase()} defaults
          </button>
        )}
      </main>
    </div>
  );
}
