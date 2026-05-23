import type { RunSpec } from '../services/processRun.js';
import type { SkillName } from '../services/skills/types.js';

/**
 * Configuration retrieved from DB settings for provider env/arg injection.
 */
export interface ProviderConfig {
  token?: string;
  tokenType?: 'oauth' | 'api-key' | 'chatgpt';
  model?: string;
  autoMemoryEnabled: boolean;
  /** Environment variable name used to inject the API key (e.g. 'OPENAI_API_KEY'). */
  envVarName?: string;
}

export interface FileSyncEntry {
  /** Absolute source path resolved from the Ralph installation. */
  sourcePath: string;
  /** Destination path relative to the project root. */
  destRelative: string;
  /** Whether the destination file should be marked executable. */
  executable?: boolean;
}

/**
 * Abstraction over AI providers so services can interact with any provider
 * through a consistent interface.
 */
export interface Provider {
  /** Unique provider identifier (e.g. 'claude') */
  readonly name: string;

  /** Path to the runner script for this provider (relative to project scripts/ralph/). */
  readonly runnerScript: string;

  describeLoop(config: ProviderConfig, modelVariant: string | undefined, projectPath: string): RunSpec;

  describeSkill(
    config: ProviderConfig,
    modelVariant: string | undefined,
    projectPath: string,
    skill: SkillName,
    prompt: string,
  ): RunSpec;

  syncManifest(): FileSyncEntry[];

  /**
   * Build environment variables to inject when spawning a process.
   * @param config  Settings read from the DB
   * @param modelVariant  Optional model variant override
   */
  getEnvVars(config: ProviderConfig, modelVariant?: string): Record<string, string>;

  /**
   * Build CLI arguments for the provider's CLI tool.
   * @param config  Settings read from the DB
   * @param modelVariant  Optional model variant override
   */
  getCliArgs(config: ProviderConfig, modelVariant?: string): string[];

  /** Return the list of supported model variant identifiers. */
  getModelVariants(): string[];

  /**
   * Return auth configuration derived from the given config.
   * @param config  Settings read from the DB
   */
  getAuthConfig(config: ProviderConfig): { tokenType: string; tokenValue: string };

  /**
   * Return the list of files to sync from the Ralph installation into a project.
   * @param ralphPath  Absolute path to the Ralph installation directory
   */
  getFilesToSync(ralphPath: string): { source: string; dest: string }[];

  /**
   * Parse raw config JSON from the providers table into a ProviderConfig.
   * Each provider maps its own DB config keys to the generic ProviderConfig shape.
   * @param rawConfig  Parsed JSON object from providers.config column
   */
  parseConfig(rawConfig: Record<string, unknown>): ProviderConfig;
}
