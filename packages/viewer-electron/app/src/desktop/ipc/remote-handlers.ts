import type { ApiHandlers } from './schemas';
import type { RemoteConnections, RemoteCaller } from '../remote/connections';

const personOnly = (message: string) =>
  Object.assign(new Error(message), { code: 'VIEWER_REMOTE_AGENT_REFUSED' });

const person = (caller: RemoteCaller | undefined): caller is RemoteCaller =>
  !!caller && caller.role !== 'agent' && !caller.agentDriven;

/** Server connections answer the person's windows only, checked again after every await. */
export function createRemoteHandlers(ports: {
  remote?: RemoteConnections;
  caller(owner: number): RemoteCaller | undefined;
}): Pick<ApiHandlers, 'remote'> {
  return {
    remote: async ([request], owner) => {
      const caller = ports.caller(owner);
      if (!person(caller)) {
        throw personOnly('Server connections are available only to the person using Viewer.');
      }
      if (!ports.remote) {
        throw Object.assign(new Error('Server connections are not available in this build.'), {
          code: 'VIEWER_REMOTE_DISABLED',
        });
      }
      const reply = await ports.remote.request(request, caller);
      if (!person(ports.caller(owner))) {
        throw personOnly('The server connection window is no longer available.');
      }
      return reply;
    },
  };
}
