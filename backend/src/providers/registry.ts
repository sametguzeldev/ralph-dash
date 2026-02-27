import type { Provider } from './types.js';
import { ClaudeProvider } from './claude.js';

const providers = new Map<string, Provider>();

function register(provider: Provider): void {
  providers.set(provider.name, provider);
}

// Register built-in providers
register(new ClaudeProvider());

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
