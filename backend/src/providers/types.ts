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

  describeLoop(config: ProviderConfig, modelVariant: string | undefined, projectPath: string): RunSpec;

  describeSkill(
    config: ProviderConfig,
    modelVariant: string | undefined,
    projectPath: string,
    skill: SkillName,
    prompt: string,
  ): RunSpec;

  /**
   * Describe the files this provider expects to be synced from the Ralph installation.
   * @param ralphPath  Absolute path to the Ralph installation directory
   */
  syncManifest(ralphPath: string): FileSyncEntry[];

  /** Return the list of supported model variant identifiers. */
  getModelVariants(): string[];

  /**
   * Return auth configuration derived from the given config.
   * @param config  Settings read from the DB
   */
  getAuthConfig(config: ProviderConfig): { tokenType: string; tokenValue: string };

  /**
   * Parse raw config JSON from the providers table into a ProviderConfig.
   * Each provider maps its own DB config keys to the generic ProviderConfig shape.
   * @param rawConfig  Parsed JSON object from providers.config column
   */
  parseConfig(rawConfig: Record<string, unknown>): ProviderConfig;
}
