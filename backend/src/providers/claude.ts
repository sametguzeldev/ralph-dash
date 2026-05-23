import path from 'path';
import type { Provider, ProviderConfig, FileSyncEntry } from './types.js';
import { cloneRunEnv, compactEnv, ensureExecutableFile, readSkillFile } from './helpers.js';
import { ProviderError } from './providerError.js';
import type { RunSpec } from '../services/processRun.js';
import type { SkillName } from '../services/skills/types.js';

const SKILLS_TO_SYNC = ['prd', 'prd-questions', 'ralph'];
const RUNNER_SCRIPT = 'ralph-cc.sh';

const MODEL_VARIANTS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

function skillFilePath(projectPath: string, skill: SkillName): string {
  return path.join(projectPath, '.claude', 'skills', skill, 'SKILL.md');
}

/**
 * Parse a stream-json line from claude CLI and extract a human-readable message.
 * Returns null if the line has no useful display content.
 */
export function parseStreamJsonLine(raw: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.trim() || null;
  }

  const type = parsed.type as string | undefined;

  if (type === 'system' && parsed.subtype === 'init') {
    return '⏳ Claude session started...';
  }

  if (type === 'assistant' && parsed.message) {
    const msg = parsed.message as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;

    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim();
        if (text) parts.push(text);
      } else if (block.type === 'tool_use') {
        const name = block.name as string;
        const input = block.input as Record<string, unknown> | undefined;
        if (name === 'Write' && input?.file_path) {
          parts.push(`📝 Writing ${input.file_path}`);
        } else if (name === 'Read' && input?.file_path) {
          parts.push(`📖 Reading ${input.file_path}`);
        } else if (name === 'Edit' && input?.file_path) {
          parts.push(`✏️  Editing ${input.file_path}`);
        } else if (name === 'Bash' && input?.command) {
          const cmd = String(input.command).slice(0, 80);
          parts.push(`💻 Running: ${cmd}`);
        } else {
          parts.push(`🔧 Using ${name}`);
        }
      }
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  if (type === 'result') {
    const result = parsed.result as string | undefined;
    if (result) return result;
    if (parsed.subtype === 'success') return '✅ Skill completed successfully';
    if (parsed.subtype === 'error') {
      const error = parsed.error as string | undefined;
      return `❌ Error: ${error || 'unknown error'}`;
    }
  }

  return null;
}

export class ClaudeProvider implements Provider {
  readonly name = 'claude';

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
    return {
      kind: 'skill',
      skillName: skill,
      command: 'claude',
      args: [
        '-p', prompt,
        '--append-system-prompt', skillContent,
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
        ...this.getCliArgs(config, modelVariant),
      ],
      cwd: projectPath,
      env: compactEnv(this.buildRunEnv(config, modelVariant)),
      parseLine: parseStreamJsonLine,
    };
  }

  syncManifest(ralphPath: string): FileSyncEntry[] {
    return [
      ...SKILLS_TO_SYNC.map((skill) => ({
        sourcePath: path.join(ralphPath, 'skills', skill, 'SKILL.md'),
        destRelative: path.join('.claude', 'skills', skill, 'SKILL.md'),
      })),
      {
        sourcePath: path.join(ralphPath, 'scripts', 'ralph', 'ralph-cc.sh'),
        destRelative: path.join('scripts', 'ralph', 'ralph-cc.sh'),
        executable: true,
      },
      {
        sourcePath: path.join(ralphPath, 'scripts', 'ralph', 'CLAUDE.md'),
        destRelative: path.join('scripts', 'ralph', 'CLAUDE.md'),
      },
    ];
  }

  private buildRunEnv(config: ProviderConfig, modelVariant?: string): Record<string, string | undefined> {
    return cloneRunEnv(this.getEnvVars(config, modelVariant));
  }

  private ensureConfigured(config: ProviderConfig): void {
    if (!config.token || !config.tokenType) {
      throw new ProviderError(
        'not-configured',
        this.name,
        "Provider 'claude' is not configured. Please configure authentication on the Models page first.",
      );
    }
  }

  private getEnvVars(config: ProviderConfig, modelVariant?: string): Record<string, string> {
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

  private getCliArgs(config: ProviderConfig, modelVariant?: string): string[] {
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

    const preferences = rawConfig.preferences && typeof rawConfig.preferences === 'object' && !Array.isArray(rawConfig.preferences)
      ? rawConfig.preferences as Record<string, unknown>
      : undefined;
    const autoMem = preferences?.autoMemoryEnabled ?? rawConfig.autoMemoryEnabled;
    const autoMemoryEnabled = autoMem === undefined ? true : (autoMem === 'true' || autoMem === true);

    return {
      token,
      tokenType,
      model: (rawConfig.claudeModel as string) || undefined,
      autoMemoryEnabled,
    };
  }

}
