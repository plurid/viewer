import type { AgentAccessRequest, AgentClient } from '../../domain/agents/clients';
import type { ApiHandlers } from './schemas';
import type { AgentBroker } from '../agents/agent-broker';
import type { AgentRequests } from '../agents/agent-requests';
import type { AgentSessions } from '../agents/sessions';

type AgentHandlers = Pick<
  ApiHandlers,
  | 'agentSessions'
  | 'agentReviewList'
  | 'agentReview'
  | 'agentGrants'
  | 'agentGrant'
  | 'agentClients'
  | 'agentAudit'
  | 'agentStop'
  | 'agentToken'
  | 'agentAccess'
>;
interface AgentPorts {
  sessions: Pick<AgentSessions, 'request'>;
  requests: Pick<AgentRequests, 'list' | 'review' | 'listGrants' | 'grant'>;
  broker: Pick<
    AgentBroker,
    'clientRequest' | 'start' | 'stop' | 'credential' | 'clients' | 'access'
  >;
  isAgent(owner: number): boolean;
  changeAccess(request: AgentAccessRequest, owner: number): Promise<void>;
}

/** An MCP client's server entry: Viewer's executable in `--mcp` mode, authorized by `token`. */
function mcpConfiguration(token: string): string {
  const env = {
    VIEWER_AGENT_TOKEN: token,
    ...(process.env.VIEWER_DATA_DIRECTORY
      ? { VIEWER_DATA_DIRECTORY: process.env.VIEWER_DATA_DIRECTORY }
      : {}),
  };
  return JSON.stringify(
    { mcpServers: { viewer: { command: process.execPath, args: ['--mcp'], env } } },
    null,
    2,
  );
}

/** Access changes are confirmed natively; each reply is the approval then in effect. */
export function createAgentHandlers(ports: AgentPorts): AgentHandlers {
  return {
    agentSessions: ([request], owner) => {
      if (ports.isAgent(owner))
        throw new Error('Saved agent transcripts are available only to the person.');
      return ports.sessions.request(request);
    },
    agentReviewList: () => ports.requests.list(),
    agentReview: ([id, approve]) => ports.requests.review(id, approve),
    agentGrants: () => ports.requests.listGrants(),
    agentGrant: ([actionID, root, capability, allow, clientID]) =>
      ports.requests.grant(actionID, root, capability, allow, clientID),
    agentClients: async ([request]) => {
      const reply = await ports.broker.clientRequest(request);
      if (request.kind !== 'create') return reply;
      await ports.broker.start();
      const created = reply as {
        client: AgentClient;
        token: string;
      };
      return { ...created, configuration: mcpConfiguration(created.token) };
    },
    agentAudit: ([clientID]) => ports.broker.clients.history(clientID),
    agentStop: ([clientID]) => ports.broker.stop(clientID),
    agentToken: async () => {
      await ports.broker.start();
      return mcpConfiguration(await ports.broker.credential());
    },
    agentAccess: async ([request], owner) => {
      await ports.changeAccess(request, owner);
      return ports.broker.access.state();
    },
  };
}
