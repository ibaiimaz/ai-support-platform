export type ProviderFailure = 'timeout' | 'connection_error' | 'http_error' | 'invalid_response';

export class ClassificationError extends Error {
  constructor(readonly kind: ProviderFailure) {
    super('Classification provider failed');
  }
}
