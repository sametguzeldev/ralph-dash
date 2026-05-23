import path from 'path';
import type { Provider, ProviderConfig, FileSyncEntry } from './types.js';
import { cloneRunEnv, compactEnv, ensureExecutableFile, readSkillFile } from './helpers.js';
import { ProviderError } from './providerError.js';
import type { RunSpec } from '../services/processRun.js';
import type { SkillName } from '../services/skills/types.js';

const SKILLS_TO_SYNC = ['prd', 'prd-questions', 'ralph'];
const MODEL_VARIANTS = ['gpt-5.5'];
const RUNNER_SCRIPT = 'ralph-codex.sh';

function skillFilePath(projectPath: string, skill: SkillName): string {
  return path.join(projectPath, '.agents', 'skills', skill, 'SKILL.md');
}

export class CodexProvider implements Provider {
  readonly name = 'codex';

  describeLoop(config: ProviderConfig, modelVariant: string | undefined, projectPath: string): RunSpec {
    this.ensureConfigured(config);
    const scriptPath = path.join(projectPath, 'scripts', 'ralph', RUNNER_SCRIPT);
    ensureExecutableFile(this.name, scriptPath, 'Script');
    return {
      kind: 'loop',
      command: 'bash',
      args: [scriptPath, ...this.getCliArgs(config, modelVariant)],
      cwd: projectPath,
      env: compactEnv(this.buildRunEnv(config, modelVariant)),
    };
  }

  describeSkill(
    config: ProviderConfig,
    modelVariant: string | undefined,
    projectPath: string,
    skill: SkillName,
    prompt: string,
  ): RunSpec {
    this.ensureConfigured(config);
    const skillContent = readSkillFile(this.name, skillFilePath(projectPath, skill));
    const model = modelVariant ?? config.model;
    return {
      kind: 'skill',
      skillName: skill,
      command: 'codex',
      args: [
        'exec',
        '--sandbox', 'danger-full-access',
        ...(model ? ['--model', model] : []),
        '--',
        `${skillContent}\n\n${prompt}`,
      ],
      cwd: projectPath,
      env: compactEnv(this.buildRunEnv(config, modelVariant)),
    };
  }

  syncManifest(ralphPath: string): FileSyncEntry[] {
    return [
      ...SKILLS_TO_SYNC.map((skill) => ({
        sourcePath: path.join(ralphPath, 'skills', skill, 'SKILL.md'),
        destRelative: path.join('.agents', 'skills', skill, 'SKILL.md'),
      })),
      {
        sourcePath: path.join(ralphPath, 'scripts', 'ralph', 'ralph-codex.sh'),
        destRelative: path.join('scripts', 'ralph', 'ralph-codex.sh'),
        executable: true,
      },
      {
        sourcePath: path.join(ralphPath, 'scripts', 'ralph', 'AGENTS.md'),
        destRelative: 'AGENTS.md',
      },
    ];
  }

  private buildRunEnv(config: ProviderConfig, modelVariant?: string): Record<string, string | undefined> {
    return cloneRunEnv(this.getEnvVars(config, modelVariant));
  }

  private ensureConfigured(config: ProviderConfig): void {
    if (config.tokenType === 'chatgpt') return;
    if (!config.token) {
      throw new ProviderError(
        'not-configured',
        this.name,
        "Provider 'codex' is not configured. Please configure authentication on the Models page first.",
      );
    }
  }

  private getEnvVars(config: ProviderConfig, modelVariant?: string): Record<string, string> {
    const env: Record<string, string> = {};

    // ChatGPT mode: Codex CLI reads ~/.codex/auth.json natively — no API key injection needed.
    // API key mode: inject token as both CODEX_API_KEY and OPENAI_API_KEY.
    if (config.tokenType !== 'chatgpt' && config.token) {
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

  private getCliArgs(_config: ProviderConfig, _modelVariant?: string): string[] {
    return [];
  }

  getModelVariants(): string[] {
    return [...MODEL_VARIANTS];
  }

  getAuthConfig(config: ProviderConfig): { tokenType: string; tokenValue: string } {
    return {
      tokenType: config.tokenType ?? 'api-key',
      tokenValue: config.tokenType === 'chatgpt' ? '' : (config.token ?? ''),
    };
  }

  parseConfig(rawConfig: Record<string, unknown>): ProviderConfig {
    const token = (rawConfig.token as string) || undefined;
    const rawTokenType = rawConfig.tokenType as string | undefined;
    const model = (rawConfig.model as string) || undefined;

    let tokenType: ProviderConfig['tokenType'];
    if (rawTokenType === 'chatgpt') {
      tokenType = 'chatgpt';
    } else if (token) {
      tokenType = 'api-key';
    }

    return {
      token,
      tokenType,
      model,
      autoMemoryEnabled: false,
    };
  }

}
