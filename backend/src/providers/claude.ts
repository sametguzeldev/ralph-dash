import path from 'path';
import type { Provider, ProviderConfig } from './types.js';

const SKILLS_TO_SYNC = ['prd', 'prd-questions', 'ralph'];
const SCRIPTS_TO_SYNC = ['ralph-cc.sh', 'CLAUDE.md'];

const MODEL_VARIANTS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

export class ClaudeProvider implements Provider {
  readonly name = 'claude';

  getEnvVars(config: ProviderConfig, modelVariant?: string): Record<string, string> {
    const env: Record<string, string> = {};

    // Auth token
    if (config.token && config.tokenType) {
      if (config.tokenType === 'oauth') {
        env.CLAUDE_CODE_OAUTH_TOKEN = config.token;
      } else {
        env.ANTHROPIC_API_KEY = config.token;
      }
    }

    // Model preference (explicit variant overrides DB setting)
    const model = modelVariant ?? config.model;
    if (model) {
      env.ANTHROPIC_MODEL = model;
    }

    // Auto-memory disable flag
    if (!config.autoMemoryEnabled) {
      env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
    }

    return env;
  }

  getCliArgs(config: ProviderConfig, modelVariant?: string): string[] {
    const args: string[] = [];
    const model = modelVariant ?? config.model;
    if (model) {
      args.push('--model', model);
    }
    return args;
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
    const token = (rawConfig.claudeToken as string) || undefined;
    let tokenType: 'oauth' | 'api-key' | undefined;

    if (rawConfig.claudeTokenType === 'oauth' || rawConfig.claudeTokenType === 'api-key') {
      tokenType = rawConfig.claudeTokenType;
    } else if (token) {
      tokenType = token.startsWith('sk-ant-oat') ? 'oauth' : 'api-key';
    }

    const autoMem = rawConfig.autoMemoryEnabled;
    const autoMemoryEnabled = autoMem === undefined ? true : (autoMem === 'true' || autoMem === true);

    return {
      token,
      tokenType,
      model: (rawConfig.claudeModel as string) || undefined,
      autoMemoryEnabled,
    };
  }

  getFilesToSync(ralphPath: string): { source: string; dest: string }[] {
    const files: { source: string; dest: string }[] = [];

    for (const skill of SKILLS_TO_SYNC) {
      files.push({
        source: path.join(ralphPath, 'skills', skill, 'SKILL.md'),
        dest: path.join('.claude', 'skills', skill, 'SKILL.md'),
      });
    }

    for (const file of SCRIPTS_TO_SYNC) {
      files.push({
        source: path.join(ralphPath, file),
        dest: path.join('scripts', 'ralph', file),
      });
    }

    return files;
  }
}
