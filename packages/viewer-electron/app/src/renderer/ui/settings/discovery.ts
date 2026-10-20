import { providerKinds, providerPresets } from '../../../domain/model-providers';
import type { ApplicationSettings } from '../../../domain/services';

/** Categories whose settings live in dedicated editors, offered when a search matches them. */
export function settingsDiscovery(settings: ApplicationSettings, query: string) {
  return [
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
        'api key credentials provider endpoint local model ' +
        providerKinds.map((kind) => providerPresets[kind].name).join(' ') +
        ' ' +
        settings.providers.map((provider) => provider.name + ' ' + provider.model).join(' '),
    },
    {
      category: 'Agents',
      terms:
        'allow local agent clients mcp token client authorization folders scope agent configuration',
    },
    { category: 'Terminals', terms: 'shell profiles environment tmux iterm external terminal' },
    { category: 'Configuration', terms: 'jsonc config file validate changes import export reset' },
    { category: 'Privacy', terms: 'privacy policy sharing data retention support email tracking' },
    {
      category: 'Permissions',
      terms: 'folder files access grant revoke sandbox privacy disk volume',
    },
    { category: 'Shortcuts', terms: 'keyboard hotkeys commands bindings' },
  ].filter((item) => query && item.terms.toLowerCase().includes(query.toLowerCase()));
}
