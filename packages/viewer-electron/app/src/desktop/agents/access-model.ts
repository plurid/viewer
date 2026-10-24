import { z } from 'zod';
import { agentCapabilities, type AgentCapability } from '../../domain/agents/clients';

const roots = z.array(z.string().min(1).max(32768)).max(100);
const capabilities = z
  .array(z.enum(agentCapabilities))
  .max(agentCapabilities.length)
  .refine((items) => new Set(items).size === items.length);

/** Version 1 cannot distinguish configuration-seeded grants from native consent. */
export const legacyAgentAuthoritySchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    roots,
    capabilities: capabilities.optional(),
  })
  .strict();

/** Only this version can confer authority; every positive change requires native review. */
export const agentAuthoritySchema = z
  .object({
    version: z.literal(2),
    enabled: z.boolean(),
    roots,
    capabilities,
    requiresReapproval: z.boolean(),
  })
  .strict();

export type AgentAuthority = z.infer<typeof agentAuthoritySchema>;

export interface AgentAccessChange {
  enabled?: boolean;
  add?: readonly string[];
  remove?: readonly string[];
  capabilities?: readonly AgentCapability[];
}

export interface AgentAccessReview {
  readonly requestedRevision?: number;
  readonly roots: readonly { path: string; canonical: string }[];
  readonly capabilities: readonly AgentCapability[];
}

export const defaultAgentAuthority = (requiresReapproval = false): AgentAuthority => ({
  version: 2,
  enabled: false,
  roots: [],
  capabilities: [],
  requiresReapproval,
});
