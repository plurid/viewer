import type { License } from '../license/license';
import type { ApiHandlers } from './schemas';

export function createLicenseHandlers(ports: {
  license?: Pick<License, 'status' | 'enter' | 'remove' | 'buy'>;
  isSettings(owner: number): boolean;
}): Pick<ApiHandlers, 'license'> {
  return {
    license: async ([request], owner) => {
      if ((request.kind === 'enter' || request.kind === 'remove') && !ports.isSettings(owner))
        throw new Error('Manage your license key in Settings → License.');
      switch (request.kind) {
        case 'status':
          return ports.license?.status(request.hideReminder);
        case 'enter':
          return ports.license?.enter(request.key);
        case 'remove':
          return ports.license?.remove();
        case 'buy':
          await ports.license?.buy();
          return ports.license?.status();
      }
    },
  };
}
