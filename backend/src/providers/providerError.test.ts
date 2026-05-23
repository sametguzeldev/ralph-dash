import { describe, expect, it } from 'vitest';
import { ProviderError } from './providerError.js';

describe('ProviderError', () => {
  it('stores structured fields and formats a useful message', () => {
    const error = new ProviderError('not-configured', 'codex', 'Missing API token');

    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('not-configured');
    expect(error.providerName).toBe('codex');
    expect(error.detail).toBe('Missing API token');
    expect(error.message).toBe('Provider codex not-configured: Missing API token');
  });
});
