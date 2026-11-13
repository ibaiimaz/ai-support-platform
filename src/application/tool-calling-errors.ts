export class InvalidToolCallError extends Error {
  readonly kind = 'invalid_tool_call';

  constructor() {
    super('Invalid classification tool request');
  }
}

export class GlobalDeadlineExceededError extends Error {
  readonly kind = 'global_deadline_exceeded';

  constructor() {
    super('Classification deadline exceeded');
  }
}

export class IncidentRepositoryError extends Error {
  readonly kind = 'repository_unavailable';

  constructor() {
    super('Incident repository unavailable');
  }
}
