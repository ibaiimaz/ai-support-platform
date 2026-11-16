import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassificationDeadline } from '../../src/application/classification-deadline.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import {
  GlobalDeadlineExceededError,
  IncidentRepositoryError,
} from '../../src/application/tool-calling-errors.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('I006-AC-10 each operation uses its own limit and the remaining monotonic budget without reservations', async () => {
  let time = 0;
  const deadline = new ClassificationDeadline(() => time);
  const budgets: number[] = [];
  await deadline.run('llm', async (budget) => {
    budgets.push(budget);
    time = 44_000;
  });
  await deadline.run('tool', async (budget) => {
    budgets.push(budget);
    time = 48_900;
  });
  await deadline.run('llm', async (budget) => {
    budgets.push(budget);
    time = 89_999;
  });

  assert.deepEqual(budgets, [45_000, 5_000, 41_100]);
  deadline.check();
});

test('I006-AC-10 an exhausted global budget prevents invocation, including exhaustion before queued start', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const queued of [false, true]) {
    let time = 0;
    const deadline = new ClassificationDeadline(() => time);
    let calls = 0;
    if (!queued) {
      time = 90_000;
    }

    const pending = deadline.run('llm', async () => {
      calls += 1;
    });
    time = 90_000;
    await assert.rejects(pending, GlobalDeadlineExceededError);
    assert.equal(calls, 0);
  }
});

test('I006-AC-10 effective timers bound operations which never resolve or honor timeouts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const kind of ['llm', 'tool'] as const) {
    let time = 0;
    const started = deferred<void>();
    const deadline = new ClassificationDeadline(() => time);
    const pending = deadline.run(kind, async () => {
      started.resolve();
      return new Promise<void>(() => {});
    });
    const rejected = assert.rejects(pending, (error) => {
      if (kind === 'tool') {
        return error instanceof IncidentRepositoryError;
      }

      return error instanceof ClassificationError && error.kind === 'timeout';
    });
    await started.promise;
    time = kind === 'llm' ? 45_000 : 5_000;
    t.mock.timers.tick(time);
    await rejected;
  }
});

test('I006-AC-10 simultaneous global and LLM deadlines choose global for either callback order', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const providerFirst of [true, false]) {
    let time = 0;
    const deadline = new ClassificationDeadline(() => time);
    time = 45_000;
    const started = deferred<void>();
    const operation = deferred<void>();
    const pending = deadline.run('llm', (budget) => {
      assert.equal(budget, 45_000);
      started.resolve();
      return operation.promise;
    });
    const rejected = assert.rejects(pending, GlobalDeadlineExceededError);
    await started.promise;
    time = 90_000;

    if (providerFirst) {
      operation.reject(new ClassificationError('timeout'));
      await rejected;
      t.mock.timers.tick(45_000);
    } else {
      t.mock.timers.tick(45_000);
      await rejected;
      operation.reject(new ClassificationError('timeout'));
      await Promise.resolve();
    }
  }
});

test('I006-AC-10 global expiration wins over tool timeout and late successful completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const kind of ['llm', 'tool'] as const) {
    let time = 0;
    const deadline = new ClassificationDeadline(() => time);
    time = kind === 'tool' ? 85_000 : 45_000;
    await assert.rejects(
      deadline.run(kind, async () => {
        time = 90_000;
        return 'late success';
      }),
      GlobalDeadlineExceededError,
    );
  }
});

test('I006-AC-10 early timer delivery cannot override the monotonic clock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  const started = deferred<void>();
  const deadline = new ClassificationDeadline(() => time);
  const pending = deadline.run('tool', async () => {
    started.resolve();
    return new Promise<void>(() => {});
  });
  const rejected = assert.rejects(pending, IncidentRepositoryError);
  await started.promise;
  time = 4_000;
  t.mock.timers.tick(5_000);
  time = 4_999;
  t.mock.timers.tick(999);
  deadline.check();
  time = 5_000;
  t.mock.timers.tick(1);
  await rejected;
});

test('I006-AC-10 late rejections stay handled and cannot replace an expired operation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  const started = deferred<void>();
  const operation = deferred<void>();
  const deadline = new ClassificationDeadline(() => time);
  const pending = deadline.run('tool', () => {
    started.resolve();
    return operation.promise;
  });
  const rejected = assert.rejects(pending, IncidentRepositoryError);
  await started.promise;
  time = 5_000;
  t.mock.timers.tick(5_000);
  await rejected;
  operation.reject(new TypeError('late failure'));
  await Promise.resolve();
});

test('I006-AC-10 completed operations clear timers and preserve unexpected errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  let clockReads = 0;
  const deadline = new ClassificationDeadline(() => {
    clockReads += 1;
    return time;
  });
  assert.equal(await deadline.run('llm', async () => 'result'), 'result');
  const failure = new TypeError('programming error');
  await assert.rejects(
    deadline.run('tool', () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  const readsAfterCompletion = clockReads;
  time = 100_000;
  t.mock.timers.tick(100_000);
  assert.equal(clockReads, readsAfterCompletion);
});
