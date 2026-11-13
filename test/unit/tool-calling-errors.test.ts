import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassificationError } from '../../src/application/classification-errors.js';
import {
  GlobalDeadlineExceededError,
  IncidentRepositoryError,
  InvalidToolCallError,
} from '../../src/application/tool-calling-errors.js';

test('I006-AC-08/10 phase 1 tool rejection and global deadline remain distinct from provider errors', () => {
  const invalidToolCall = new InvalidToolCallError();
  const globalDeadline = new GlobalDeadlineExceededError();

  assert.ok(invalidToolCall instanceof Error);
  assert.ok(globalDeadline instanceof Error);
  assert.equal(invalidToolCall.kind, 'invalid_tool_call');
  assert.equal(globalDeadline.kind, 'global_deadline_exceeded');
  assert.equal(invalidToolCall instanceof ClassificationError, false);
  assert.equal(globalDeadline instanceof ClassificationError, false);
  assert.equal(new ClassificationError('timeout').kind, 'timeout');
});

test('I006-AC-06 phase 1 repository technical failures remain distinct from absence and provider failure', async () => {
  const failure = new IncidentRepositoryError();

  assert.ok(failure instanceof Error);
  assert.equal(failure.kind, 'repository_unavailable');
  assert.equal(failure instanceof ClassificationError, false);
  assert.equal(failure.message, 'Incident repository unavailable');
  await assert.rejects(Promise.reject(failure), (error) => error === failure);
});
