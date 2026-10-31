import type { ModelProvider } from '../services';
import { samModel } from './sam';

export const providerKinds = [
  'openai',
  'anthropic',
  'zai',
  'deepseek',
  'qwen',
  'gemini',
  'openrouter',
  'meta',
  'local',
] as const;
export type ProviderKind = (typeof providerKinds)[number];

/** Gemini resource names and its OpenAI-compatible chat IDs identify the same model. */
export function providerModelID(kind: ProviderKind, model: string): string {
  const id = model.trim();
  return kind === 'gemini' ? id.replace(/^models\//, '') : id;
}

/** How a provider is asked: OpenAI's Responses API, Anthropic's Messages API, or the Chat
 * Completions API most other providers share. */
export type ProviderProtocol = 'responses' | 'messages' | 'chat/completions';
/**
 * How a provider is held to the answer's schema: a strict `json_schema`, a `json_object` with the
 * schema in the instructions, or Anthropic's tool call.
 */
export type ProviderOutput = 'schema' | 'json' | 'tool';
/** How long a model reasons before it answers, sent as Chat Completions' `reasoning_effort`. */
export const reasoningEfforts = ['minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  minimal: 'Minimal: fastest answers',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
interface ProviderPreset {
  name: string;
  endpoint: string;
  protocol: ProviderProtocol;
  output: ProviderOutput;
  suggestedModels?: readonly string[];
  /** The model a new provider of this kind starts with. */
  model?: string;
  /** What people call its models: "Muse Spark". */
  family?: string;
  /** The model its Responses route outlines features with, from a box or words. */
  segmentation?: string;
  /** The reasoning efforts it accepts; without one, every request uses the API's own. */
  efforts?: readonly ReasoningEffort[];
  note?: string;
}

/** Provider identity, transport and setup defaults share one catalog. Model IDs remain editable. */
export const providerPresets: Record<ProviderKind, ProviderPreset> = {
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    protocol: 'responses',
    output: 'schema',
  },
  anthropic: {
    name: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    protocol: 'messages',
    output: 'tool',
  },
  zai: {
    name: 'z.ai',
    endpoint: 'https://api.z.ai/api/paas/v4',
    protocol: 'chat/completions',
    output: 'json',
    suggestedModels: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
    note: 'Use a Z.ai Model API key. Enter a GLM model ID or choose a suggested model.',
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    protocol: 'chat/completions',
    output: 'json',
  },
  qwen: {
    name: 'Qwen',
    endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    protocol: 'chat/completions',
    output: 'schema',
    note: 'Use your Alibaba Model Studio API key and its regional endpoint. Workspace-specific endpoints are supported. Choose a model that supports structured output in non-thinking mode.',
  },
  gemini: {
    name: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'chat/completions',
    output: 'schema',
  },
  openrouter: {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    protocol: 'chat/completions',
    output: 'schema',
    note: 'Choose a model with structured output support. Requests use providers that honor the required parameters.',
  },
  meta: {
    name: 'Meta',
    endpoint: 'https://api.meta.ai/v1',
    protocol: 'chat/completions',
    // tools/meta-probe.ts confirmed strict schemas; were they refused, this would be 'json'.
    output: 'schema',
    model: 'muse-spark-1.3',
    family: 'Muse Spark',
    segmentation: samModel,
    // Checked live: `minimal` cuts the reasoning, `low` is accepted; `reasoning: {effort}` is refused.
    efforts: ['minimal', 'low'],
    note: 'Use a Meta Model API key; the key for Meta speech in Settings → Speech is kept apart. Enter a Muse Spark model ID.',
  },
  local: {
    name: 'Local endpoint',
    endpoint: 'http://localhost:11434/v1',
    protocol: 'chat/completions',
    output: 'schema',
  },
};

/** Whether a provider's kind accepts a reasoning effort. */
export const providerTakesEffort = (kind: ProviderKind, effort: ReasoningEffort) =>
  providerPresets[kind].efforts?.includes(effort) ?? false;

/** Pictures go as `image_url` parts of a Chat Completions message; Viewer does not send them
 * through the Responses or Messages APIs yet. */
export const providerTakesImages = (kind: ProviderKind) =>
  providerPresets[kind].protocol === 'chat/completions';

/**
 * The SAM model a provider outlines features with on its own Responses route: Meta's, or the one a
 * local server says it also answers, as SAM 3.1's weights are open. Any other kind has none.
 */
export function providerSegmentation(
  provider: Pick<ModelProvider, 'kind' | 'segmentation'>,
): string | undefined {
  const own = providerPresets[provider.kind].segmentation;
  if (own) return own;
  return provider.kind === 'local' ? provider.segmentation?.trim() || undefined : undefined;
}

export const qwenEndpoints = [
  { label: 'Singapore', endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  { label: 'US (Virginia)', endpoint: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
  { label: 'China (Beijing)', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  {
    label: 'China (Hong Kong)',
    endpoint: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
  },
] as const;

export function newModelProvider(kind: ProviderKind, id: string): ModelProvider {
  const preset = providerPresets[kind];
  return {
    id,
    kind,
    name: preset.name,
    endpoint: preset.endpoint,
    model: preset.model ?? '',
    allowContent: false,
  };
}

/** Named cloud providers cannot silently send their stored key to an unrelated server. */
export function validProviderEndpoint(kind: ProviderKind, endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash) return false;
    const normalized = url.href.replace(/\/+$/, '');
    if (kind === 'local')
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      );
    if (kind === 'qwen')
      return (
        qwenEndpoints.some((item) => item.endpoint === normalized) ||
        (url.protocol === 'https:' &&
          !url.port &&
          /^[a-z0-9-]+\.(?:cn-beijing|ap-southeast-1|cn-hongkong|ap-northeast-1)\.maas\.aliyuncs\.com$/.test(
            url.hostname,
          ) &&
          url.pathname.replace(/\/+$/, '') === '/compatible-mode/v1')
      );
    // DeepSeek also documents /v1 as an equivalent API base.
    if (kind === 'deepseek' && normalized === 'https://api.deepseek.com/v1') return true;
    return normalized === providerPresets[kind].endpoint;
  } catch {
    return false;
  }
}
