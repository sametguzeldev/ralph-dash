import type { Provider, ProviderConfig } from './types.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { OpenCodeProvider } from './opencode.js';
import { ProviderError } from './providerError.js';
import { db } from '../db/connection.js';

export const DEFAULT_PROVIDER = 'claude';

const providers = new Map<string, Provider>();

function register(provider: Provider): void {
  providers.set(provider.name, provider);
}

// Register built-in providers
register(new ClaudeProvider());
register(new CodexProvider());
register(new OpenCodeProvider());

/**
 * Get a provider by name.
 * @throws Error if the provider is not registered
 */
export function getProvider(name: string): Provider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Resolve a provider by name, throwing a ProviderError so route handlers can
 * surface a structured `invalid-config` response when the project references
 * a provider that isn't registered.
 */
export function requireProvider(name: string): Provider {
  try {
    return getProvider(name);
  } catch {
    throw new ProviderError('invalid-config', name, `Unknown provider: ${name}`);
  }
}

/**
 * Return all registered providers.
 */
export function getAllProviders(): Provider[] {
  return Array.from(providers.values());
}

/**
 * Read git identity from settings so spawned provider runs commit under the
 * user's configured author/committer rather than the container default.
 * Returns an empty object when either setting is missing.
 */
export function loadGitIdentity(): Record<string, string> {
  const name = (db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserName') as { value: string } | undefined)?.value;
  const email = (db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserEmail') as { value: string } | undefined)?.value;
  if (!name || !email) return {};
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

/**
 * Load and parse provider config from DB.
 */
export function loadProviderConfig(providerName: string): ProviderConfig {
  const provider = getProvider(providerName);
  const row = db.prepare('SELECT config FROM providers WHERE name = ?').get(providerName) as { config: string | null } | undefined;
  if (!row?.config) {
    return provider.parseConfig({});
  }
  try {
    const rawConfig = JSON.parse(row.config) as Record<string, unknown>;
    return provider.parseConfig(rawConfig);
  } catch {
    return provider.parseConfig({});
  }
}
