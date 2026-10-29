import type { BrowserWindow } from 'electron';
import type { DesktopEvent } from '../../domain/contracts';
import { modelDataLabels, modelEndpoint } from '../../domain/models/permissions';
import type { ApiHandlers } from './schemas';
import type { SettingsService } from '../preferences/settings';
import { providerBinding, type Credentials, type Providers } from '../models/providers';
import type { ModelPermissions } from '../models/model-permissions';
import { confirmNatively } from '../native/native-confirmation';
import type { FileAccess } from '../files/file-access';
import { guessFile } from '../models/file-guess';

type ModelHandlers = Pick<
  ApiHandlers,
  | 'providerCredential'
  | 'providerModels'
  | 'providerCheck'
  | 'providerPermissionGet'
  | 'providerPermissionSet'
  | 'providerPermissionAgents'
  | 'identifyFile'
>;
interface ModelPorts {
  settings: SettingsService;
  credentials: Credentials;
  providers: Providers;
  modelPermissions: ModelPermissions;
  fileAccess: Pick<FileAccess, 'require'>;
  window(sender: number): BrowserWindow | undefined;
  emit(event: DesktopEvent): void;
}

/** Credentials and data consent remain bound to the provider's current endpoint. */
export function createModelHandlers(ports: ModelPorts): ModelHandlers {
  const requireProvider = (id: string) => {
    const selected = ports.settings.snapshot().settings.providers.find((item) => item.id === id);
    if (!selected) throw new Error('Provider is unavailable.');
    return selected;
  };
  return {
    providerCredential: async (args) => {
      const provider = ports.settings
        .snapshot()
        .settings.providers.find((item) => item.id === args[0]);
      if (!args[1]) {
        if (provider) await ports.modelPermissions.set(provider, null);
        ports.emit({ type: 'model-permission', providerID: args[0] });
      } else if (!provider)
        // a key is tied to its provider's endpoint as it is saved: one without a provider was not
        throw new Error('Save the provider in Settings → Models before entering its key.');
      await ports.credentials.set(
        args[0],
        args[1],
        provider ? providerBinding(provider) : undefined,
      );
      ports.settings.announce();
      return;
    },
    providerModels: (args) => {
      const provider = ports.settings
        .snapshot()
        .settings.providers.find((provider) => provider.id === args[0]);
      if (!provider) throw new Error('Provider is unavailable.');
      return ports.providers.models(provider);
    },
    providerCheck: ([request]) =>
      ports.providers.check(requireProvider(request.providerID), request.kind),
    providerPermissionGet: ([id]) => ports.modelPermissions.get(requireProvider(id)),
    providerPermissionSet: async ([id, endpoint, level], senderID) => {
      const provider = requireProvider(id);
      if (modelEndpoint(provider) !== modelEndpoint({ endpoint }))
        throw new Error(
          'The provider endpoint changed. Review its new address before allowing data access.',
        );
      // A renderer could store this approval by itself, and with it send document text to any
      // https host it had configured: the person grants it here, natively.
      if (
        level &&
        !(await confirmNatively(
          ports.window(senderID),
          `Allow Viewer to send ${modelDataLabels[level]} to ${provider.name}?`,
          `Actions using this provider send your instructions and that data to:\n${modelEndpoint(provider)}\n\nYou can revoke this in Settings → Models.`,
          'Allow',
        ))
      )
        throw new Error('Model data access was not allowed.');
      await ports.modelPermissions.set(provider, level);
      ports.emit({ type: 'model-permission', providerID: provider.id });
    },
    providerPermissionAgents: async ([id, endpoint, allow], senderID) => {
      const provider = requireProvider(id);
      if (modelEndpoint(provider) !== modelEndpoint({ endpoint }))
        throw new Error(
          'The provider endpoint changed. Review its new address before allowing data access.',
        );
      const permission = await ports.modelPermissions.get(provider);
      if (
        allow &&
        permission &&
        !(await confirmNatively(
          ports.window(senderID),
          `Let actions agents start send ${modelDataLabels[permission.level]} to ${provider.name}?`,
          `An agent's request to run an action then sends your files' data to:\n${modelEndpoint(provider)}\n\nYou can turn this off in Settings → Models.`,
          'Allow',
        ))
      )
        throw new Error('Agent access to model data was not allowed.');
      await ports.modelPermissions.allowAgents(provider, allow);
      ports.emit({ type: 'model-permission', providerID: provider.id });
    },
    // asked for from a preview Viewer cannot show; an answer that takes longer is not waited for
    identifyFile: ([file]) =>
      guessFile(
        file,
        ports.settings.snapshot().settings,
        (...generate) => ports.providers.generate(...generate),
        (files) => ports.fileAccess.require(files),
        AbortSignal.timeout(30000),
      ),
  };
}
