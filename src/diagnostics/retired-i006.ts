export class RetiredI006DiagnosticError extends Error {
  readonly code = 'I006_DIAGNOSTIC_RETIRED';

  constructor() {
    super('I006 revision 5 diagnostic retired; execution is permanently disabled.');
  }
}
