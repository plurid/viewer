import type { ModelProvider } from './services';

export const providerKinds = [
  'openai',
  'anthropic',
  'zai',
  'deepseek',
  'qwen',
  'gemini',
  'openrouter',
  'local',
] as const;
export type ProviderKind = (typeof providerKinds)[number];

interface ProviderPreset {
  name: string;
  endpoint: string;
  protocol: 'responses' | 'messages' | 'chat/completions';
  output: 'schema' | 'json' | 'tool';
  suggestedModels?: readonly string[];
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
  local: {
    name: 'Local endpoint',
    endpoint: 'http://localhost:11434/v1',
    protocol: 'chat/completions',
    output: 'schema',
  },
};

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
  return { id, kind, name: preset.name, endpoint: preset.endpoint, model: '', allowContent: false };
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
