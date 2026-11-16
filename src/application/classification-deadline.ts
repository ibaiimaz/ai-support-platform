import { performance } from 'node:perf_hooks';
import { ClassificationError } from './classification-errors.js';
import { classificationTimeouts } from './classification-timeouts.js';
import { GlobalDeadlineExceededError, IncidentRepositoryError } from './tool-calling-errors.js';

export class ClassificationDeadline {
  private readonly expiresAt: number;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.expiresAt = this.now() + classificationTimeouts.overallMs;
  }

  check(): void {
    if (this.now() >= this.expiresAt) {
      throw new GlobalDeadlineExceededError();
    }
  }

  async run<T>(kind: 'llm' | 'tool', operation: (timeoutMs: number) => Promise<T>): Promise<T> {
    const start = this.now();
    if (start >= this.expiresAt) {
      throw new GlobalDeadlineExceededError();
    }

    const limit =
      kind === 'llm' ? classificationTimeouts.llmCallMs : classificationTimeouts.toolCallMs;
    const operationExpiresAt = Math.min(start + limit, this.expiresAt);
    const timeoutMs = operationExpiresAt - start;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const expired = (time = this.now()): Error | null => {
      if (time >= this.expiresAt) {
        return new GlobalDeadlineExceededError();
      }

      if (time >= operationExpiresAt) {
        return kind === 'llm' ? new ClassificationError('timeout') : new IncidentRepositoryError();
      }

      return null;
    };

    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const fail = (error: unknown) => {
          if (settled) {
            return;
          }

          settled = true;
          reject(expired() ?? error);
        };
        const onTimeout = () => {
          if (settled) {
            return;
          }

          const error = expired();
          if (error) {
            fail(error);
          } else {
            // Timers only wake the check; the monotonic clock determines expiration.
            timer = setTimeout(onTimeout, operationExpiresAt - this.now());
          }
        };
        timer = setTimeout(onTimeout, timeoutMs);

        Promise.resolve()
          .then(() => {
            const time = this.now();
            const error = expired(time);
            if (error) {
              throw error;
            }

            return operation(operationExpiresAt - time);
          })
          .then((value) => {
            if (settled) {
              return;
            }

            const error = expired();
            if (error) {
              fail(error);
              return;
            }

            settled = true;
            resolve(value);
          }, fail);
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
