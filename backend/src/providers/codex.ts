import type { Provider, ProviderConfig } from './types.js';

const MODEL_VARIANTS = [
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.2',
  'gpt-5.1-codex-mini',
];

export class CodexProvider implements Provider {
  readonly name = 'codex';
  readonly runnerScript = 'ralph-codex.sh';

  getEnvVars(config: ProviderConfig, modelVariant?: string): Record<string, string> {
    const env: Record<string, string> = {};

    // Inject token as both CODEX_API_KEY and OPENAI_API_KEY
    if (config.token) {
      env.CODEX_API_KEY = config.token;
      env.OPENAI_API_KEY = config.token;
    }

    // Model preference (explicit variant overrides DB setting)
    const model = modelVariant ?? config.model;
    if (model) {
      env.CODEX_MODEL = model;
    }

    return env;
  }

  getCliArgs(_config: ProviderConfig, _modelVariant?: string): string[] {
    return ['--full-auto'];
  }

  getModelVariants(): string[] {
    return [...MODEL_VARIANTS];
  }

  getAuthConfig(config: ProviderConfig): { tokenType: string; tokenValue: string } {
    return {
      tokenType: config.tokenType ?? 'api-key',
      tokenValue: config.token ?? '',
    };
  }

  parseConfig(rawConfig: Record<string, unknown>): ProviderConfig {
    const token = (rawConfig.token as string) || undefined;
    const model = (rawConfig.model as string) || undefined;

    return {
      token,
      tokenType: token ? 'api-key' : undefined,
      model,
      autoMemoryEnabled: false,
    };
  }

  getFilesToSync(_ralphPath: string): { source: string; dest: string }[] {
    return [];
  }
}
