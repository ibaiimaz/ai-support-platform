import { plannedPhases } from '../../src/evaluation/tool-calling/protocol.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withControl,
  readAuthorization,
  requireAuthorization,
  type Authorization,
} from '../../src/evaluation/tool-calling/control.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import { synchronization } from '../../src/evaluation/durable-files.js';
import { candidate, identity, perfectResults } from './helpers.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'i006-test-'));
  const directory = join(root, 'controls');
  const authorizationPath = join(root, 'authorization.json');
  const authorization: Authorization = {
    schemaVersion: 2,
    protocolId: 'I006-HYBRID-CLASSIFICATION-V1',
    experiment: 'I006',
    datasetReview: 'APPROVED_FROZEN',
    datasetHash: identity.datasetHash,
    initialize: true,
    execute: true,
    identityHash: sha256(JSON.stringify(identity)),
    approvalReference: 'SIMULATED-APPROVAL',
    maximumInferences: 104,
  };
  await writeFile(authorizationPath, JSON.stringify(authorization));
  const dataset = await candidate();
  const invoke = (
    initialize: boolean,
    operation: Parameters<typeof withControl>[5],
    sync = synchronization,
  ) => withControl(directory, dataset, identity, authorizationPath, initialize, operation, sync);
  return { root, directory, authorizationPath, authorization, dataset, invoke };
}

test('AC-12/21: explicit initialization, durable reservation before dispatch, full 104-slot cap and single-use closure', async () => {
  const fixture = await setup();
  try {
    await fixture.invoke(true, async () => {
      assert.fail('Initialization must not dispatch');
    });
    const initial = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
    assert.equal(initial.phase, 'READY');
    assert.equal(initial.observedAttempts, 0);
    const results = perfectResults(fixture.dataset);
    await fixture.invoke(false, async (control) => {
      let slots = 0;
      for (const [index, example] of fixture.dataset.examples.entries()) {
        await control.reserve(example);
        const reserved = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
        assert.equal(reserved.pending, example.id);
        slots += plannedPhases(example.description).length;
        assert.equal(reserved.reservedSlots, slots);
        for (const phase of plannedPhases(example.description)) {
          await control.attempt(example, phase);
          control.dispatch(example);
        }
        await control.record(results[index]!);
      }
      await assert.rejects(control.reserve(fixture.dataset.examples[0]!));
    });
    const final = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
    assert.equal(final.phase, 'CLOSED');
    assert.equal(final.reservedSlots, 104);
    assert.equal(final.observedAttempts, 104);
    await assert.rejects(
      fixture.invoke(false, async () => {
        assert.fail('Repeat');
      }),
    );
    await assert.rejects(fixture.invoke(true, async () => {}));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/21: absent, corrupt or uncertain ledger blocks continuation and cannot reset via initialization', async () => {
  for (const state of ['absent', 'corrupt', 'pending', 'attempt-without-result']) {
    const fixture = await setup();
    try {
      await fixture.invoke(true, async () => {});
      const path = join(fixture.directory, 'budget.json');
      if (state === 'absent') {
        await rm(path);
      } else if (state === 'corrupt') {
        await writeFile(path, '{');
      } else {
        const ledger = JSON.parse(await readFile(path, 'utf8'));
        ledger.pending = 'I006-001';
        ledger.reservedSlots = 2;
        ledger.observedAttempts = state === 'pending' ? 0 : 1;
        await writeFile(path, JSON.stringify(ledger));
      }
      await assert.rejects(
        fixture.invoke(false, async () => {
          assert.fail('Must block');
        }),
      );
      await assert.rejects(
        fixture.invoke(true, async () => {
          assert.fail('Must not reset');
        }),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test('AC-12: missing controls during continuation and pre-existing evidence during initialization fail closed', async () => {
  const fixture = await setup();
  try {
    await assert.rejects(
      fixture.invoke(false, async () => {
        assert.fail('No ledger');
      }),
    );
    await writeFile(join(fixture.directory, 'partial.json'), '{}');
    await assert.rejects(
      fixture.invoke(true, async () => {}),
      /Prior/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12: concurrent process-equivalent control acquisition specifically rejects existing lock', async () => {
  const fixture = await setup();
  try {
    await fixture.invoke(true, async () => {});
    await fixture.invoke(false, async () => {
      assert.ok((await readdir(fixture.directory)).includes('budget.lock'));
      await assert.rejects(
        fixture.invoke(false, async () => {
          assert.fail('Concurrent entry');
        }),
        (error: NodeJS.ErrnoException) =>
          error.code === 'EEXIST' && error.path === join(fixture.directory, 'budget.lock'),
      );
      assert.ok((await readdir(fixture.directory)).includes('budget.lock'));
    });
    assert.equal((await readdir(fixture.directory)).includes('budget.lock'), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/21: interrupted reservation retains uncertain slots and cannot reopen with historical approval', async () => {
  const fixture = await setup();
  try {
    await fixture.invoke(true, async () => {});
    await assert.rejects(
      fixture.invoke(false, async (control) => {
        await control.reserve(fixture.dataset.examples[0]!);
        throw new Error('interruption before response');
      }),
    );
    const ledger = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
    assert.equal(ledger.pending, 'I006-001');
    assert.equal(ledger.reservedSlots, 1);
    assert.equal(ledger.observedAttempts, 0);
    await assert.rejects(
      fixture.invoke(false, async () => {
        assert.fail('Historical approval cannot reopen');
      }),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/21: sync failure prevents dispatch and failed initialization cannot silently restart', async () => {
  for (const failDuring of ['initialize', 'reserve']) {
    const fixture = await setup();
    try {
      if (failDuring === 'initialize') {
        await assert.rejects(
          fixture.invoke(true, async () => {}, {
            ...synchronization,
            async file() {
              throw new Error('disk sync');
            },
          }),
        );
        await assert.rejects(fixture.invoke(true, async () => {}));
      } else {
        await fixture.invoke(true, async () => {});
        let writes = 0;
        let dispatched = false;
        await assert.rejects(
          fixture.invoke(
            false,
            async (control) => {
              await control.reserve(fixture.dataset.examples[0]!);
              dispatched = true;
            },
            {
              ...synchronization,
              async file(handle) {
                writes++;
                if (writes === 2) {
                  throw new Error('disk sync');
                }
                await handle.sync();
              },
            },
          ),
        );
        assert.equal(dispatched, false);
        await assert.rejects(fixture.invoke(false, async () => {}));
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test('AC-12: permissions, frozen identity and approval are required and rechecked before each case', async () => {
  const fixture = await setup();
  try {
    for (const change of [
      { execute: false },
      { datasetReview: 'PENDING_HUMAN_REVIEW' },
      { datasetHash: '0'.repeat(64) },
      { identityHash: '0'.repeat(64) },
      { approvalReference: null },
    ]) {
      assert.throws(() =>
        requireAuthorization(
          { ...fixture.authorization, ...change } as Authorization,
          identity,
          'execute',
        ),
      );
    }
    await writeFile(
      fixture.authorizationPath,
      JSON.stringify({ ...fixture.authorization, force: true }),
    );
    await assert.rejects(readAuthorization(fixture.authorizationPath));
    await writeFile(fixture.authorizationPath, JSON.stringify(fixture.authorization));
    await fixture.invoke(true, async () => {});
    await fixture.invoke(false, async (control) => {
      await writeFile(
        fixture.authorizationPath,
        JSON.stringify({ ...fixture.authorization, execute: false }),
      );
      await assert.rejects(control.reserve(fixture.dataset.examples[0]!));
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/21: surviving report prevents a new experiment after loss of the control directory', async () => {
  const fixture = await setup();
  try {
    await writeFile(
      join(fixture.root, '12345678-1234-1234-1234-123456789abc-1-INCOMPLETE.json'),
      '{}',
    );
    await assert.rejects(
      fixture.invoke(true, async () => {}),
      /Prior/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/21: disappearing durable ledger during a run is never silently recreated', async () => {
  const fixture = await setup();
  try {
    await fixture.invoke(true, async () => {});
    let entered = false;
    await assert.rejects(
      fixture.invoke(false, async (control) => {
        await rm(join(fixture.directory, 'budget.json'));
        await control.reserve(fixture.dataset.examples[0]!);
        entered = true;
      }),
    );
    assert.equal(entered, false);
    await assert.rejects(readFile(join(fixture.directory, 'budget.json')));
    await assert.rejects(fixture.invoke(true, async () => {}));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/26/29 R7: durable per-phase attempt precedes dispatch and revocation blocks the reserved send', async () => {
  const fixture = await setup();
  try {
    await fixture.invoke(true, async () => {});
    await fixture.invoke(false, async (control) => {
      const example = fixture.dataset.examples[0]!;
      await control.reserve(example);
      await control.attempt(example, 'classification');
      const journal = JSON.parse(
        await readFile(join(fixture.directory, `${example.id}-classification.json`), 'utf8'),
      );
      assert.deepEqual(journal, {
        id: example.id,
        phase: 'classification',
        state: 'RESERVED_POSSIBLE_DISPATCH',
      });
      const ledger = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
      assert.equal(ledger.observedAttempts, 1);
      assert.equal(ledger.reservedSlots, 1);
      control.verifyDispatch(example);
      await writeFile(
        fixture.authorizationPath,
        JSON.stringify({ ...fixture.authorization, execute: false }),
      );
      assert.throws(() => control.verifyDispatch(example), /not authorized/);
      await assert.rejects(control.attempt(example, 'classification'), /not authorized/);
    });
    const final = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
    assert.equal(final.observedAttempts, 1);
    assert.equal(final.pending, 'I006-001');
    assert.equal(final.phase, 'CLOSED');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/26/29 R7: out-of-order, duplicate and concurrent attempt reservations permanently block dispatch', async () => {
  for (const scenario of ['out-of-order', 'duplicate', 'concurrent']) {
    const fixture = await setup();
    try {
      await fixture.invoke(true, async () => {});
      await fixture.invoke(false, async (control) => {
        const example = fixture.dataset.examples[0]!;
        await control.reserve(example);
        if (scenario === 'out-of-order') {
          await assert.rejects(control.attempt(example, 'decision'), /blocked/);
        } else if (scenario === 'duplicate') {
          await control.attempt(example, 'classification');
          await assert.rejects(control.attempt(example, 'classification'), /blocked/);
        } else {
          const attempts = await Promise.allSettled([
            control.attempt(example, 'classification'),
            control.attempt(example, 'classification'),
          ]);
          assert.ok(attempts.every((attempt) => attempt.status === 'rejected'));
          assert.ok(
            attempts.some(
              (attempt) =>
                attempt.status === 'rejected' &&
                attempt.reason.message === 'Concurrent inference reservation',
            ),
          );
        }
        assert.throws(() => control.verifyDispatch(example), /changed/);
        await assert.rejects(control.attempt(example, 'classification'), /blocked/);
      });
      const ledger = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
      assert.equal(ledger.reservedSlots, 1);
      assert.equal(ledger.pending, 'I006-001');
      assert.ok(ledger.observedAttempts <= 1);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test('AC-12/26/29 R7: attempt persistence failure prevents dispatch and keeps uncertain reservation closed', async () => {
  const fixture = await setup();
  try {
    await fixture.invoke(true, async () => {});
    let failPersistence = false;
    let dispatched = false;
    await fixture.invoke(
      false,
      async (control) => {
        const example = fixture.dataset.examples[0]!;
        await control.reserve(example);
        failPersistence = true;
        await assert.rejects(control.attempt(example, 'classification'), /simulated sync failure/);
        assert.throws(() => control.verifyDispatch(example), /changed/);
        try {
          control.verifyDispatch(example);
          dispatched = true;
        } catch {
          // A durable uncertainty must never reach the simulated provider.
        }
        failPersistence = false;
      },
      {
        ...synchronization,
        async file(handle) {
          if (failPersistence) {
            throw new Error('simulated sync failure');
          }
          await handle.sync();
        },
      },
    );
    assert.equal(dispatched, false);
    const ledger = JSON.parse(await readFile(join(fixture.directory, 'budget.json'), 'utf8'));
    assert.equal(ledger.phase, 'CLOSED');
    assert.equal(ledger.reservedSlots, 1);
    assert.equal(ledger.pending, 'I006-001');
    await assert.rejects(fixture.invoke(false, async () => {}));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('AC-12/29 R7: disabled authorization fails before creating the controls namespace', async () => {
  const fixture = await setup();
  try {
    await writeFile(
      fixture.authorizationPath,
      JSON.stringify({ ...fixture.authorization, initialize: false, execute: false }),
    );
    await assert.rejects(
      fixture.invoke(true, async () => {}),
      /not authorized/,
    );
    await assert.rejects(
      fixture.invoke(false, async () => {}),
      /not authorized/,
    );
    await assert.rejects(readdir(fixture.directory), { code: 'ENOENT' });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
