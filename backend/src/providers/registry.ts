import type { Provider, ProviderConfig } from './types.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { OpenCodeProvider } from './opencode.js';
import { db } from '../db/connection.js';

export const DEFAULT_PROVIDER = 'claude';

const providers = new Map<string, Provider>();

function register(provider: Provider): void {
  providers.set(provider.name, provider);
}

function isRegisteredProvider(name: string | null | undefined): name is string {
  return typeof name === 'string' && providers.has(name);
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
 * Return all registered providers.
 */
export function getAllProviders(): Provider[] {
  return Array.from(providers.values());
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

/**
 * Normalize a persisted model variant for providers with fixed variant lists.
 * Stale selections fall back to the provider default instead of being passed
 * through to the underlying CLI.
 */
export function normalizeModelVariant(providerName: string | null | undefined, modelVariant: string | null | undefined): string | undefined {
  const trimmed = modelVariant?.trim();
  if (!providerName || !trimmed) return undefined;

  if (!isRegisteredProvider(providerName)) return undefined;
  const provider = getProvider(providerName);
  const variants = provider.getModelVariants();
  if (variants.length === 0) return trimmed;
  if (variants.includes(trimmed)) return trimmed;
  return variants[0];
}

/**
 * Resolve the effective review provider/variant for a project.
 * Defaulting cascade: review_provider -> provider -> DEFAULT_PROVIDER.
 * The model variant follows the same provider it was stored under, so a
 * Codex model_variant is never paired with Claude (or vice versa). Stale
 * variants are normalized.
 */
export function resolveReviewProvider(project: {
  provider: string | null;
  model_variant: string | null;
  review_provider: string | null;
  review_model_variant: string | null;
}): { providerName: string; modelVariant: string | undefined } {
  if (isRegisteredProvider(project.review_provider)) {
    return {
      providerName: project.review_provider,
      modelVariant: normalizeModelVariant(project.review_provider, project.review_model_variant),
    };
  }
  if (isRegisteredProvider(project.provider)) {
    return {
      providerName: project.provider,
      modelVariant: normalizeModelVariant(project.provider, project.model_variant),
    };
  }
  return { providerName: DEFAULT_PROVIDER, modelVariant: undefined };
}

/**
 * Build environment variables for spawning a provider-backed process.
 * Clones process.env, strips CLAUDECODE, injects provider env vars and git identity.
 * @param providerName  Provider name (e.g., 'claude', 'codex')
 * @param modelVariant  Optional model variant override
 * @param providerConfig  Optional pre-loaded provider config (avoids redundant DB query)
 */
export function buildRunEnv(
  providerName: string,
  modelVariant?: string,
  providerConfig?: ProviderConfig
): Record<string, string | undefined> {
  const provider = getProvider(providerName);
  const config = providerConfig ?? loadProviderConfig(providerName);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const effectiveModelVariant = normalizeModelVariant(providerName, modelVariant);

  // Inject provider env vars (auth token, model, etc.) — skip vars already set
  const providerEnv = provider.getEnvVars(config, effectiveModelVariant);
  for (const [key, value] of Object.entries(providerEnv)) {
    if (!env[key]) {
      env[key] = value;
    }
  }

  // Inject git identity from DB if not already set
  const nameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserName') as { value: string } | undefined;
  const emailRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserEmail') as { value: string } | undefined;
  if (nameRow?.value && emailRow?.value) {
    if (!env.GIT_AUTHOR_NAME) env.GIT_AUTHOR_NAME = nameRow.value;
    if (!env.GIT_AUTHOR_EMAIL) env.GIT_AUTHOR_EMAIL = emailRow.value;
    if (!env.GIT_COMMITTER_NAME) env.GIT_COMMITTER_NAME = nameRow.value;
    if (!env.GIT_COMMITTER_EMAIL) env.GIT_COMMITTER_EMAIL = emailRow.value;
  }

  return env;
}
