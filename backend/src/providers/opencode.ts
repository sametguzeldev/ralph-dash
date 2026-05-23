import path from 'path';
import type { Provider, ProviderConfig, FileSyncEntry } from './types.js';
import { ProviderError } from './providerError.js';
import { cloneRunEnv, compactEnv, getRalphPath } from './helpers.js';
import type { RunSpec } from '../services/processRun.js';
import type { SkillName } from '../services/skills/types.js';

export class OpenCodeProvider implements Provider {
  readonly name = 'opencode';
  readonly runnerScript = 'ralph-opencode.sh';

  describeLoop(config: ProviderConfig, modelVariant: string | undefined, projectPath: string): RunSpec {
    const scriptPath = path.join(projectPath, 'scripts', 'ralph', this.runnerScript);
    return {
      kind: 'loop',
      command: 'bash',
      args: [scriptPath, ...this.getCliArgs(config, modelVariant)],
      cwd: projectPath,
      env: compactEnv(this.buildRunEnv(config, modelVariant)),
    };
  }

  describeSkill(
    _config: ProviderConfig,
    _modelVariant: string | undefined,
    _projectPath: string,
    _skill: SkillName,
    _prompt: string,
  ): RunSpec {
    throw new ProviderError('not-configured', 'opencode', 'Skill runs are not supported for opencode');
  }

  syncManifest(): FileSyncEntry[] {
    const root = getRalphPath(this.name);
    return [
      {
        sourcePath: path.join(root, 'scripts', 'ralph', 'ralph-opencode.sh'),
        destRelative: path.join('scripts', 'ralph', 'ralph-opencode.sh'),
        executable: true,
      },
      {
        sourcePath: path.join(root, 'scripts', 'ralph', 'OPENCODE.md'),
        destRelative: 'OPENCODE.md',
      },
    ];
  }

  private buildRunEnv(config: ProviderConfig, modelVariant?: string): Record<string, string | undefined> {
    const env = cloneRunEnv(this.getEnvVars(config, modelVariant));
    const model = modelVariant ?? config.model;
    if (model && !env.OPENCODE_MODEL) {
      env.OPENCODE_MODEL = model;
    }
    return env;
  }

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

  getFilesToSync(ralphPath: string): { source: string; dest: string }[] {
    return [{ source: path.join(ralphPath, 'scripts', 'ralph', 'ralph-opencode.sh'), dest: 'scripts/ralph/ralph-opencode.sh' }];
  }
}
