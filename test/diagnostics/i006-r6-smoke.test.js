import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { smokeCase } from '../../dist/src/diagnostics/i006-smoke.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, run } from '../../scripts/i006-r6-smoke.js';
import { synchronization } from '../../dist/src/evaluation/durable-files.js';
import { sha256 } from '../../dist/src/evaluation/dataset.js';

const datasetPath = 'evals/datasets/incidents-tool-calling-v1.json';
const syntheticIdentity = { diagnostic: 'SIMULATED_R6_SMOKE' };
const state = {
  identity: syntheticIdentity,
  identityHash: sha256(JSON.stringify(syntheticIdentity)),
  scenarios: [
    {
      id: 'I006-001',
      description: JSON.parse(readFileSync(datasetPath)).examples[0].description,
      lookup: false,
    },
    { id: 'I006-R6-INC-142', description: smokeCase.description, lookup: true },
  ],
  verify() {
    assert.equal(
      sha256(readFileSync(datasetPath)),
      'fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490',
    );
  },
};
const final = (category = 'BUG') => ({
  role: 'assistant',
  content: JSON.stringify({ type: 'classification', category }),
});
const lookup = () => ({
  role: 'assistant',
  tool_calls: [{ function: { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } } }],
});
const response = (message) => Response.json({ done: true, done_reason: 'stop', message });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'i006-r6-smoke-'));
  const permissionPath = join(root, 'authorization.json');
  const outputDirectory = join(root, 'evidence');
  await writeFile(
    permissionPath,
    JSON.stringify({
      schemaVersion: 1,
      diagnostic: 'I006_R6_SMOKE',
      execute: true,
      identityHash: state.identityHash,
      approvalReference: 'SIMULATED-ONLY',
      maximumAttempts: 4,
      dedicated: true,
      serverPid: 42,
    }),
  );
  const messages = [
    { role: 'assistant', content: 'PRIVATE ignored decision text' },
    final(),
    lookup(),
    final(),
  ];
  let sent = 0;
  let preflights = 0;
  const payloads = [];
  const options = {
    state,
    permissionPath,
    outputDirectory,
    async preflight() {
      preflights++;
    },
    async request(_url, init) {
      sent++;
      assert.ok(
        existsSync(join(outputDirectory, `attempt-${sent}.json`)),
        'journal precedes dispatch',
      );
      payloads.push(JSON.parse(String(init.body)));
      return response(messages[sent - 1]);
    },
  };
  return {
    root,
    permissionPath,
    outputDirectory,
    messages,
    options,
    payloads,
    sent: () => sent,
    preflights: () => preflights,
  };
}

test('R6 smoke local check is network-free and cannot initialize evidence', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Static check accessed network'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head === 'ee8e8b87fa0707d314ba59e880ea6181717dc9ef') {
    const verified = await check();
    assert.equal(
      verified.identityHash,
      'c9fe02642def0e8f7fc487100cd8cfb0be8c54e7315665aa8c2c544faf2a9830',
    );
    assert.deepEqual(
      verified.scenarios.map((item) => item.id),
      ['I006-001', 'I006-R6-INC-142'],
    );
  } else {
    await assert.rejects(check(), /IMPLEMENTATION_IDENTITY_MISMATCH/);
  }
  assert.equal(
    JSON.parse(await readFile('evals/experiments/i006-r6-smoke-authorization.json', 'utf8'))
      .execute,
    false,
  );
});

test('R6 smoke real composition follows both fixed scenarios in four durable sends with native unchanged payloads', async () => {
  const f = await fixture();
  try {
    const report = await run(f.options);
    assert.equal(report.status, 'PASSED');
    assert.equal(f.sent(), 4);
    assert.equal(f.preflights(), 5);
    assert.deepEqual(
      report.results.map((item) => [
        item.firstResponse,
        item.toolExecutions,
        item.toolOutcome,
        item.finalCategory,
      ]),
      [
        ['no_lookup', 0, null, 'BUG'],
        ['tool_calls', 1, 'FOUND', 'BUG'],
      ],
    );
    assert.ok(
      report.attempts.every(
        (item) => item.reservation === 'DURABLE' && item.dispatched && item.validated,
      ),
    );
    for (const [index, payload] of f.payloads.entries()) {
      assert.equal(payload.model, 'llama3.1:8b');
      assert.deepEqual(payload.options, { temperature: 0 });
      assert.equal(Object.hasOwn(payload, 'tools'), index % 2 === 0);
      assert.equal(Object.hasOwn(payload, 'format'), index % 2 === 1);
    }
    assert.equal(
      f.payloads[1].messages.some((message) => message.content.includes('PRIVATE')),
      false,
    );
    const bytes = await readFile(join(f.outputDirectory, 'report.json'));
    assert.equal(
      (await readFile(join(f.outputDirectory, 'report.json.sha256'), 'utf8')).trim(),
      sha256(bytes),
    );
    assert.equal(bytes.includes('PRIVATE'), false);
    assert.equal(bytes.includes(state.scenarios[0].description), false);
    assert.equal(bytes.includes('arguments'), false);
    await assert.rejects(run(f.options), /ALREADY_STARTED/);
    assert.equal(f.sent(), 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('R6 smoke stops at any functional or technical deviation without tools or subsequent scenarios', async () => {
  for (const first of [lookup(), { role: 'assistant', content: 7 }]) {
    const f = await fixture();
    try {
      f.messages[0] = first;
      const report = await run(f.options);
      assert.equal(report.status, 'STOPPED');
      assert.equal(f.sent(), 1);
      assert.equal(report.results[0].toolExecutions, 0);
      assert.equal(
        report.results[0].status,
        typeof first.content === 'number' ? 'TECHNICAL_ERROR' : 'FUNCTIONAL_DEVIATION',
      );
      if (typeof first.content === 'number') {
        assert.deepEqual(report.results[0].error, {
          kind: 'invalid_response',
          diagnostic: 'ENVELOPE_INVALID',
        });
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
  const f = await fixture();
  try {
    f.messages[1] = final('FEATURE');
    const report = await run(f.options);
    assert.equal(f.sent(), 2);
    assert.equal(report.results[0].status, 'FUNCTIONAL_DEVIATION');
    assert.equal(report.results[0].finalCategory, 'FEATURE');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('R6 smoke disabled permission and failed isolation cannot create controls or access provider', async () => {
  for (const reason of ['disabled', 'isolation']) {
    const f = await fixture();
    try {
      if (reason === 'disabled') {
        const permission = JSON.parse(await readFile(f.permissionPath, 'utf8'));
        permission.execute = false;
        await writeFile(f.permissionPath, JSON.stringify(permission));
      } else {
        f.options.preflight = async () => {
          throw new Error('simulated isolation failure');
        };
      }
      await assert.rejects(run(f.options));
      assert.equal(f.sent(), 0);
      assert.equal(existsSync(f.outputDirectory), false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test('R6 smoke revocation between phases blocks the second send and preserves consumed reservation', async () => {
  const f = await fixture();
  try {
    const request = f.options.request;
    f.options.request = async (...args) => {
      const result = await request(...args);
      const permission = JSON.parse(await readFile(f.permissionPath, 'utf8'));
      permission.execute = false;
      await writeFile(f.permissionPath, JSON.stringify(permission));
      return result;
    };
    const report = await run(f.options);
    assert.equal(f.sent(), 1);
    assert.equal(report.attempts.length, 1);
    assert.equal(report.results[0].status, 'OPERATIONAL_ERROR');
    await assert.rejects(run(f.options));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('R6 smoke concurrent invocation rejects specifically at lock and never adds provider calls', async () => {
  const f = await fixture();
  try {
    let entered;
    let release;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const request = f.options.request;
    f.options.request = async (...args) => {
      if (f.sent() === 0) {
        entered();
        await held;
      }
      return request(...args);
    };
    const first = run(f.options);
    await ready;
    await assert.rejects(
      run(f.options),
      (error) => error.code === 'EEXIST' && error.path === join(f.outputDirectory, 'budget.lock'),
    );
    release();
    assert.equal((await first).status, 'PASSED');
    assert.equal(f.sent(), 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('R6 smoke failed durable reservation prevents sends, reports uncertainty and permanently blocks repetition', async () => {
  const f = await fixture();
  try {
    let failed = false;
    f.options.sync = {
      ...synchronization,
      async directory(path) {
        if (!failed && existsSync(join(f.outputDirectory, 'attempt-1.json'))) {
          failed = true;
          throw new Error('PRIVATE synchronization error');
        }
        await synchronization.directory(path);
      },
    };
    const report = await run(f.options);
    assert.equal(f.sent(), 0);
    assert.equal(report.status, 'STOPPED');
    assert.equal(report.results[0].status, 'OPERATIONAL_ERROR');
    assert.equal(report.attempts[0].reservation, 'UNCERTAIN');
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
    await assert.rejects(run(f.options), /ALREADY_STARTED/);
    assert.ok((await readdir(f.outputDirectory)).includes('started.json'));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('R6 smoke missing, wrong or repeated lookup in B stops before any unauthorized repository access or extra send', async () => {
  for (const deviation of ['missing', 'wrong-id', 'multiple', 'additional']) {
    const f = await fixture();
    try {
      if (deviation === 'missing') {
        f.messages[2] = { role: 'assistant', content: 'no lookup' };
      } else if (deviation === 'wrong-id') {
        f.messages[2] = {
          role: 'assistant',
          tool_calls: [
            { function: { name: 'getIncidentById', arguments: { incidentId: 'INC-201' } } },
          ],
        };
      } else if (deviation === 'multiple') {
        f.messages[2] = {
          role: 'assistant',
          tool_calls: [...lookup().tool_calls, ...lookup().tool_calls],
        };
      } else {
        f.messages[3] = lookup();
      }
      const report = await run(f.options);
      assert.equal(report.status, 'STOPPED');
      assert.equal(f.sent(), deviation === 'additional' ? 4 : 3);
      assert.equal(report.results[1].toolExecutions, deviation === 'additional' ? 1 : 0);
      assert.equal(report.results[1].status, 'FUNCTIONAL_DEVIATION');
      assert.ok(report.attempts.length <= 4);
      assert.ok(report.attempts.filter((item) => item.scenario === 'I006-R6-INC-142').length <= 2);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test('R6 smoke timeout, known transport failure and unavailable report storage cannot trigger retries', async () => {
  for (const failure of ['timeout', 'connection', 'report-storage']) {
    const f = await fixture();
    try {
      if (failure !== 'report-storage') {
        const request = f.options.request;
        f.options.request = async (...args) => {
          await request(...args);
          if (failure === 'timeout') {
            throw new (
              await import('../../dist/src/application/classification-errors.js')
            ).ClassificationError('timeout');
          }
          const error = new Error('PRIVATE transport detail');
          error.code = 'ECONNRESET';
          throw error;
        };
        const report = await run(f.options);
        assert.equal(f.sent(), 1);
        assert.equal(report.results[0].status, 'TECHNICAL_ERROR');
        assert.equal(
          report.results[0].error.kind,
          failure === 'timeout' ? 'timeout' : 'connection_error',
        );
        assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
      } else {
        f.options.sync = {
          ...synchronization,
          async directory(path) {
            if (existsSync(join(f.outputDirectory, 'report.json'))) {
              throw new Error('simulated report storage unavailable');
            }
            await synchronization.directory(path);
          },
        };
        await assert.rejects(run(f.options), /report storage unavailable/);
        assert.equal(f.sent(), 4);
      }
      await assert.rejects(run(f.options), /ALREADY_STARTED/);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});
