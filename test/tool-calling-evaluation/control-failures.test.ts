import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withControl, type Authorization } from '../../src/evaluation/tool-calling/control.js';
import { runControlledEvaluation } from '../../src/evaluation/tool-calling/main.js';
import { buildReport, saveReport } from '../../src/evaluation/tool-calling/report.js';
import { synchronization } from '../../src/evaluation/durable-files.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import type { EvaluationReport } from '../../src/evaluation/tool-calling/types.js';
import { candidate, identity } from './helpers.js';

async function fixture(withReferences = true) {
  const root = await mkdtemp(join(tmpdir(), 'i006-control-failure-'));
  const directory = join(root, 'controls');
  const reports = join(root, 'reports');
  await mkdir(reports);
  const authorizationPath = join(root, 'authorization.json');
  const authorization: Authorization = {
    schemaVersion: 2,
    protocolId: identity.protocolId,
    experiment: 'I006',
    datasetReview: 'APPROVED_FROZEN',
    datasetHash: identity.datasetHash,
    identityHash: sha256(JSON.stringify(identity)),
    approvalReference: 'SIMULATED-ONLY',
    initialize: true,
    execute: true,
    maximumInferences: 104,
  };
  await writeFile(authorizationPath, JSON.stringify(authorization));
  const dataset = await candidate();
  // Reference-bearing simulations preserve the original two-phase control-failure paths.
  dataset.examples = dataset.examples.slice(0, 2);
  for (const example of dataset.examples) {
    if (withReferences) {
      example.description += ' Referencia INC-142';
    }
  }
  await withControl(directory, dataset, identity, authorizationPath, true, async () => {
    assert.fail('Initialization cannot infer');
  });
  let sends = 0;
  const request: typeof fetch = async (_input, init) => {
    sends++;
    const body = JSON.parse(String(init?.body));
    const example = dataset.examples.find((item) => item.description === body.messages[1].content)!;
    assert.ok(example);
    return Response.json({
      done: true,
      done_reason: 'stop',
      message: {
        role: 'assistant',
        content: body.tools
          ? 'No lookup needed.'
          : JSON.stringify({ type: 'classification', category: example.expectedFinal.category }),
      },
    });
  };
  const checkpoints: EvaluationReport[] = [];
  const options = {
    config: { baseUrl: 'http://simulated.invalid', model: 'simulated' },
    request,
    async verifyCase() {},
    verifyDispatch() {},
    async checkpoint(results: EvaluationReport['results']) {
      const report = buildReport(dataset, identity, results, new Date().toISOString());
      await saveReport(reports, report);
      checkpoints.push(report);
    },
  };
  return {
    root,
    directory,
    reports,
    dataset,
    authorizationPath,
    authorization,
    options,
    checkpoints,
    sends: () => sends,
    revoke: () =>
      writeFile(authorizationPath, JSON.stringify({ ...authorization, execute: false })),
    ledger: async () => JSON.parse(await readFile(join(directory, 'budget.json'), 'utf8')),
    execute: (sync = synchronization) =>
      withControl(
        directory,
        dataset,
        identity,
        authorizationPath,
        false,
        (control) => runControlledEvaluation(dataset, control, options),
        sync,
      ),
  };
}

test('AC-19/21/26 control rejection before first case or inference reservation persists a zero-attempt partial report', async () => {
  for (const stage of ['case', 'inference']) {
    const f = await fixture();
    try {
      if (stage === 'case') {
        f.options.verifyCase = f.revoke;
      } else {
        f.options.verifyDispatch = () => assert.fail('No dispatch should be reached');
      }
      const result =
        stage === 'case'
          ? await f.execute()
          : await withControl(
              f.directory,
              f.dataset,
              identity,
              f.authorizationPath,
              false,
              async (control) => {
                const attempt = control.attempt.bind(control);
                control.attempt = async (example, phase) => {
                  await f.revoke();
                  return attempt(example, phase);
                };
                return runControlledEvaluation(f.dataset, control, f.options);
              },
            );
      assert.equal(f.sends(), 0);
      assert.equal(result?.length, 1);
      const report = f.checkpoints.at(-1)!;
      assert.equal(report.status, 'INCOMPLETE');
      const failure = report.results[0]!;
      assert.equal(failure.error, 'control_error');
      assert.equal(failure.failurePhase, 'control');
      assert.equal(failure.phases.decision.started, stage === 'inference');
      assert.equal(failure.phases.decision.attempts, 0);
      assert.equal(failure.phases.decision.dispatched, 0);
      assert.equal(failure.observation.inferenceCount, 0);
      const ledger = await f.ledger();
      assert.equal(ledger.phase, 'CLOSED');
      assert.equal(ledger.observedAttempts, 0);
      assert.equal(ledger.reservedSlots, stage === 'case' ? 0 : 2);
      assert.equal(ledger.results.length, 1);
      await assert.rejects(f.execute());
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test('AC-19/21/26 revocation or failed reservation between phases preserves previous results and current technical failure', async () => {
  for (const failure of ['revocation', 'reservation']) {
    const f = await fixture();
    try {
      let failWrite = false;
      const request = f.options.request;
      f.options.request = async (input, init) => {
        const response = await request(input, init);
        if (f.sends() === 3) {
          if (failure === 'revocation') {
            await f.revoke();
          } else {
            failWrite = true;
          }
        }
        return response;
      };
      const sync = {
        ...synchronization,
        async file(handle: Parameters<typeof synchronization.file>[0]) {
          if (failWrite) {
            failWrite = false;
            throw new Error('PRIVATE persistence detail');
          }
          await synchronization.file(handle);
        },
      };
      await f.execute(sync);
      assert.equal(f.sends(), 3);
      const report = f.checkpoints.at(-1)!;
      assert.equal(report.status, 'INCOMPLETE');
      assert.equal(report.results.length, 2);
      assert.equal(report.results[0]!.outcome, 'COMPLETED');
      assert.deepEqual(report.results[0], f.checkpoints[0]!.results[0]);
      const current = report.results[1]!;
      assert.equal(current.outcome, 'TECHNICAL_ERROR');
      assert.equal(current.error, 'control_error');
      assert.equal(current.failurePhase, 'control');
      assert.equal(current.phases.decision.started, true);
      assert.equal(current.phases.decision.attempts, 1);
      assert.equal(current.phases.decision.dispatched, 1);
      assert.equal(current.phases.classification.started, true);
      assert.equal(current.phases.classification.attempts, 0);
      assert.equal(current.phases.classification.dispatched, 0);
      assert.equal(current.phases.classification.reservationUncertain, failure === 'reservation');
      assert.equal(current.observation.inferenceCount, 1);
      const ledger = await f.ledger();
      assert.equal(ledger.observedAttempts, 3);
      assert.equal(ledger.reservedSlots, 4);
      assert.equal(ledger.pending, 'I006-002');
      assert.equal(ledger.phase, 'CLOSED');
      assert.equal(ledger.results.length, 2);
      assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
      await assert.rejects(f.execute());
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test('AC-21/26 control ledger write uncertainty still preserves a sanitized checkpoint without repairing the ledger', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    let failed = false;
    const sync = {
      ...synchronization,
      async directory(path: string) {
        if (path === f.directory) {
          calls++;
          // Execution snapshot, RUNNING, case reservation, attempt journal, attempt ledger.
          if (calls === 5) {
            failed = true;
            throw new Error('PRIVATE directory sync detail');
          }
        }
        await synchronization.directory(path);
      },
    };
    await assert.rejects(f.execute(sync));
    assert.equal(failed, true);
    assert.equal(f.sends(), 0);
    const report = f.checkpoints.at(-1)!;
    assert.equal(report.status, 'INCOMPLETE');
    assert.equal(report.results[0]!.error, 'control_error');
    assert.equal(report.results[0]!.phases.decision.reservationUncertain, true);
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
    const ledger = await f.ledger();
    assert.equal(ledger.observedAttempts, 1);
    assert.equal(ledger.reservedSlots, 2);
    assert.equal(ledger.pending, 'I006-001');
    assert.equal(ledger.phase, 'RUNNING');
    await assert.rejects(f.execute());
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('AC-21/26 unavailable checkpoint storage preserves prior evidence and consumed reservations without further sends', async () => {
  const f = await fixture();
  try {
    const request = f.options.request;
    f.options.request = async (input, init) => {
      const response = await request(input, init);
      if (f.sends() === 3) {
        await f.revoke();
      }
      return response;
    };
    const checkpoint = f.options.checkpoint;
    f.options.checkpoint = async (results) => {
      if (results.length === 2) {
        throw new Error('simulated report storage unavailable');
      }
      await checkpoint(results);
    };
    await assert.rejects(f.execute(), /report storage unavailable/);
    assert.equal(f.sends(), 3);
    assert.equal(f.checkpoints.length, 1);
    assert.equal(f.checkpoints[0]!.results[0]!.outcome, 'COMPLETED');
    assert.equal((await readdir(f.reports)).length, 2);
    const ledger = await f.ledger();
    assert.equal(ledger.observedAttempts, 3);
    assert.equal(ledger.reservedSlots, 4);
    assert.equal(ledger.results[1].error, 'control_error');
    assert.equal(ledger.phase, 'CLOSED');
    await assert.rejects(f.execute());
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('AC-19/21 zero-attempt control failures do not relax strict ledger/result consistency', async () => {
  const f = await fixture();
  try {
    await withControl(
      f.directory,
      f.dataset,
      identity,
      f.authorizationPath,
      false,
      async (control) => {
        let failedCase: EvaluationReport['results'][number] | undefined;
        const options = {
          ...f.options,
          async verifyCase() {
            await f.revoke();
          },
          async checkpoint(results: EvaluationReport['results']) {
            failedCase = results[0];
          },
        };
        // Capture a genuine zero-attempt failure while testing record validation separately.
        const record = control.record.bind(control);
        control.record = async (result) => {
          const forged = structuredClone(result);
          forged.outcome = 'COMPLETED';
          forged.final = { status: 'CLASSIFIED', category: 'BUG' };
          forged.observation.toolDecisionCorrect = true;
          await assert.rejects(record(forged), /does not match reservation/);
          forged.outcome = 'TECHNICAL_ERROR';
          forged.final = null;
          forged.observation.toolDecisionCorrect = null;
          forged.phases.decision.attempts = 1;
          forged.observation.inferenceCount = 1;
          await assert.rejects(record(forged), /does not match reservation/);
          await record(result);
        };
        await runControlledEvaluation(f.dataset, control, options);
        assert.equal(failedCase?.outcome, 'TECHNICAL_ERROR');
      },
    );
    assert.equal(f.sends(), 0);
    const ledger = await f.ledger();
    assert.equal(ledger.observedAttempts, 0);
    assert.equal(ledger.reservedSlots, 0);
    assert.equal(ledger.results.length, 1);
    assert.equal(ledger.phase, 'CLOSED');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('AC-19/21/26/29 CODE route reserves classification durably and preserves prefix after revocation', async () => {
  const f = await fixture(false);
  try {
    const request = f.options.request;
    f.options.request = async (input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.tools, undefined);
      assert.ok(body.format);
      const journal = JSON.parse(
        await readFile(join(f.directory, 'I006-001-classification.json'), 'utf8'),
      );
      assert.equal(journal.phase, 'classification');
      assert.equal((await f.ledger()).observedAttempts, 1);
      const response = await request(input, init);
      await f.revoke();
      return response;
    };
    await f.execute();
    assert.equal(f.sends(), 1);
    const report = f.checkpoints.at(-1)!;
    assert.equal(report.results.length, 2);
    assert.equal(report.results[0]!.outcome, 'COMPLETED');
    assert.equal(report.results[0]!.observation.decisionSource, 'CODE');
    assert.equal(report.results[0]!.phases.decision.started, false);
    assert.equal(report.results[1]!.error, 'control_error');
    assert.equal(report.results[1]!.observation.inferenceCount, 0);
    const ledger = await f.ledger();
    assert.equal(ledger.reservedSlots, 1);
    assert.equal(ledger.observedAttempts, 1);
    assert.equal(ledger.phase, 'CLOSED');
    await assert.rejects(f.execute());
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('AC-19/21/29 failed CODE inference reservation never counts a logical phase as a reserved attempt', async () => {
  const f = await fixture(false);
  try {
    await withControl(
      f.directory,
      f.dataset,
      identity,
      f.authorizationPath,
      false,
      async (control) => {
        const attempt = control.attempt.bind(control);
        control.attempt = async (example, phase) => {
          assert.equal(phase, 'classification');
          await f.revoke();
          return attempt(example, phase);
        };
        await runControlledEvaluation(f.dataset, control, f.options);
      },
    );
    assert.equal(f.sends(), 0);
    const failed = f.checkpoints.at(-1)!.results[0]!;
    assert.equal(failed.phases.classification.started, true);
    assert.equal(failed.phases.classification.attempts, 0);
    assert.equal(failed.phases.decision.started, false);
    assert.equal(failed.observation.inferenceCount, 0);
    assert.equal(failed.error, 'control_error');
    assert.equal((await f.ledger()).reservedSlots, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
