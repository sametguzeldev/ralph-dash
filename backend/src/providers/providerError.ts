export type ProviderErrorKind = 'not-configured' | 'artifact-missing' | 'invalid-config' | 'unsupported';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly providerName: string,
    readonly detail: string,
  ) {
    super(`Provider ${providerName} ${kind}: ${detail}`);
    this.name = 'ProviderError';
  }
}
