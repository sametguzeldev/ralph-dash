/**
 * Configuration retrieved from DB settings for provider env/arg injection.
 */
export interface ProviderConfig {
  token?: string;
  tokenType?: 'oauth' | 'api-key';
  model?: string;
  autoMemoryEnabled: boolean;
}

/**
 * Abstraction over AI providers so services can interact with any provider
 * through a consistent interface.
 */
export interface Provider {
  /** Unique provider identifier (e.g. 'claude') */
  readonly name: string;

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
}
