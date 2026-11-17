export type ProviderFailure = 'timeout' | 'connection_error' | 'http_error' | 'invalid_response';

export const invalidResponseDiagnostics = [
  'RESPONSE_BODY_MISSING',
  'RESPONSE_TOO_LARGE',
  'ENVELOPE_JSON_INVALID',
  'ENVELOPE_INVALID',
  'TERMINATION_INVALID',
  'MIXED_CONTENT_AND_TOOLS',
  'TOOL_CALL_STRUCTURE_INVALID',
  'FINAL_CONTENT_INVALID',
  'FINAL_JSON_INVALID',
  'FINAL_SCHEMA_INVALID',
  'INTERNAL_RESPONSE_INVALID',
] as const;

export type InvalidResponseDiagnostic = (typeof invalidResponseDiagnostics)[number];

export function isInvalidResponseDiagnostic(value: unknown): value is InvalidResponseDiagnostic {
  return invalidResponseDiagnostics.some((diagnostic) => diagnostic === value);
}

export class ClassificationError extends Error {
  readonly diagnostic?: InvalidResponseDiagnostic;

  constructor(
    readonly kind: ProviderFailure,
    diagnostic?: InvalidResponseDiagnostic,
  ) {
    super('Classification provider failed');
    if (kind === 'invalid_response' && isInvalidResponseDiagnostic(diagnostic)) {
      this.diagnostic = diagnostic;
    }
  }
}
