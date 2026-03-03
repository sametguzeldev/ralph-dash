import type { Provider, ProviderConfig } from './types.js';

export class OpenCodeProvider implements Provider {
  readonly name = 'opencode';
  readonly runnerScript = 'ralph-opencode.sh';

  getEnvVars(config: ProviderConfig, _modelVariant?: string): Record<string, string> {
    const env: Record<string, string> = {};

    // Inject token using the user-specified envVarName (e.g., OPENAI_API_KEY)
    if (config.token && config.envVarName) {
      env[config.envVarName] = config.token;
    }

    return env;
  }

  getCliArgs(_config: ProviderConfig, _modelVariant?: string): string[] {
    return ['--yolo'];
  }

  getModelVariants(): string[] {
    // OpenCode uses free-text model input, not a fixed list
    return [];
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
    const envVarName = (rawConfig.envVarName as string) || undefined;

    return {
      token,
      tokenType: token ? 'api-key' : undefined,
      model,
      autoMemoryEnabled: false,
      envVarName,
    };
  }

  getFilesToSync(_ralphPath: string): { source: string; dest: string }[] {
    return [];
  }
}
