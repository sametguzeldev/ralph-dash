import path from 'path';
import type { Provider, ProviderConfig, FileSyncEntry } from './types.js';
import { cloneRunEnv, compactEnv, getRalphPath, readSkillFile } from './helpers.js';
import type { RunSpec } from '../services/processRun.js';
import type { SkillName } from '../services/skills/types.js';

const SKILLS_TO_SYNC = ['prd', 'prd-questions', 'ralph'];
const MODEL_VARIANTS = ['gpt-5.5'];

function skillFilePath(projectPath: string, skill: SkillName): string {
  return path.join(projectPath, '.agents', 'skills', skill, 'SKILL.md');
}

export class CodexProvider implements Provider {
  readonly name = 'codex';
  readonly runnerScript = 'ralph-codex.sh';

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
    config: ProviderConfig,
    modelVariant: string | undefined,
    projectPath: string,
    skill: SkillName,
    prompt: string,
  ): RunSpec {
    const skillContent = readSkillFile(this.name, skillFilePath(projectPath, skill));
    const model = modelVariant ?? config.model;
    return {
      kind: 'skill',
      skillName: skill,
      command: 'codex',
      args: [
        'exec',
        '--sandbox', 'workspace-write',
        '--ask-for-approval', 'never',
        ...(model ? ['--model', model] : []),
        `${skillContent}\n\n${prompt}`,
      ],
      cwd: projectPath,
      env: compactEnv(this.buildRunEnv(config, modelVariant)),
    };
  }

  syncManifest(): FileSyncEntry[] {
    const root = getRalphPath(this.name);
    return [
      ...SKILLS_TO_SYNC.map((skill) => ({
        sourcePath: path.join(root, 'skills', skill, 'SKILL.md'),
        destRelative: path.join('.agents', 'skills', skill, 'SKILL.md'),
      })),
      {
        sourcePath: path.join(root, 'scripts', 'ralph', 'ralph-codex.sh'),
        destRelative: path.join('scripts', 'ralph', 'ralph-codex.sh'),
        executable: true,
      },
      {
        sourcePath: path.join(root, 'scripts', 'ralph', 'AGENTS.md'),
        destRelative: 'AGENTS.md',
      },
    ];
  }

  private buildRunEnv(config: ProviderConfig, modelVariant?: string): Record<string, string | undefined> {
    return cloneRunEnv(this.getEnvVars(config, modelVariant));
  }

  getEnvVars(config: ProviderConfig, modelVariant?: string): Record<string, string> {
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

  getCliArgs(_config: ProviderConfig, _modelVariant?: string): string[] {
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

  getFilesToSync(ralphPath: string): { source: string; dest: string }[] {
    return [{ source: path.join(ralphPath, 'scripts', 'ralph', 'ralph-codex.sh'), dest: 'scripts/ralph/ralph-codex.sh' }];
  }
}
