import { z } from 'zod';
import { serviceTools } from './service-catalog';
import { agentToolCatalog } from './tool-catalog';
/** The MCP tools Viewer offers agents. Every call is still authorized per client,
 * capability and folder, and anything that changes files waits for review. */
export const agentTools = [
  ...serviceTools,
  // Input mode: a field with a default may be omitted.
  ...Object.entries(agentToolCatalog).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
  })),
];
