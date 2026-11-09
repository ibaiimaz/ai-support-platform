import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, readdir, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { sha256 } from '../../src/evaluation/dataset.js';
import {
  initializeLedger,
  withLedger,
  reserve,
  type DiskSynchronization,
} from '../../src/evaluation/model-comparison/budget.js';
import { executeCli } from '../../src/evaluation/model-comparison/main.js';
import { project } from './helpers.js';

async function directory(t: Parameters<typeof project>[0]) {
  const path = await mkdtemp(join(tmpdir(), 'i004-ledger-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function savedState(path: string) {
  return JSON.parse(await readFile(join(path, 'budget.json'), 'utf8'));
}

function failingSync(kind: 'file' | 'directory', at: number): DiskSynchronization {
  let files = 0;
  let directories = 0;
  return {
    async file(handle) {
      await handle.sync();
      files++;
      if (kind === 'file' && files === at) {
        throw new Error('Injected file synchronization failure');
      }
    },
    async directory(path) {
      const handle = await open(path, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      directories++;
      if (kind === 'directory' && directories === at) {
        throw new Error('Injected directory synchronization failure');
      }
    },
  };
}

test('I004-AC-02 I004-AC-10 inicialización explícita válida a cero y continuación sin reinicializar', async (t) => {
  const path = await directory(t);
  let entered = false;
  await assert.rejects(
    withLedger(path, async () => {
      entered = true;
    }),
  );
  assert.equal(entered, false);
  assert.deepEqual(await readdir(path), []);
  const initialized = await initializeLedger(path);
  assert.equal(initialized.attempted, 0);
  assert.equal(initialized.reserved, 0);
  const initial = await savedState(path);
  const marker = JSON.parse(await readFile(join(path, 'budget-initialization.json'), 'utf8'));
  assert.equal(initial.instanceId, marker.instanceId);
  assert.equal(marker.ledgerSha256, sha256(await readFile(join(path, 'budget.json'))));
  assert.equal(initial.revision, 0);
  assert.equal(marker.state, 'ready');
  await withLedger(path, async (ledger) => {
    entered = true;
    assert.deepEqual(ledger.attempts, []);
  });
  assert.equal(entered, true);
  await assert.rejects(initializeLedger(path));
  assert.deepEqual(await savedState(path), initial);
});

test('I004-AC-02 inicialización CLI no requiere modelos, permisos, Ollama o archivos internos manuales', async (t) => {
  const f = await project(t, false);
  for (const state of Object.values(f.manifest.authorization)) {
    for (const approval of Object.values(state)) {
      approval.approved = false;
    }
  }
  f.manifest.environment.dedicated = false;
  for (const identity of Object.values(f.manifest.models)) {
    identity.digest = null;
  }
  await f.saveManifest();
  const dependencies = {
    observer() {
      throw new Error('No observer allowed');
    },
    classifier() {
      throw new Error('No classifier allowed');
    },
  };
  const result = await executeCli(f.root, ['--initialize'], dependencies);
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(JSON.parse(result.output).attempted, 0);
  const state = await savedState(join(f.root, 'evals/reports/i004'));
  assert.equal(state.attempts.length, 0);
  assert.equal((await executeCli(f.root, ['--initialize'], dependencies)).exitCode, 1);
  for (const args of [
    ['--initialize', '--force'],
    ['--initialize', '--phase', 'compatibility'],
    ['--force'],
  ]) {
    assert.equal((await executeCli(f.root, args, dependencies)).exitCode, 1);
  }
  assert.equal(f.counters().calls, 0);
});

test('I004-AC-10 ledger perdido después de ejecución bloquea continuación e inicialización', async (t) => {
  const f = await project(t);
  const response = await f.run('compatibility', 'llama3.1:8b');
  assert.equal(response.exitCode, 0, response.output);
  const path = join(f.root, 'evals/reports/i004');
  await unlink(join(path, 'budget.json'));
  assert.equal((await f.run('compatibility', 'llama3.1:8b')).exitCode, 1);
  assert.equal((await f.run('compatibility', 'gemma3:12b')).exitCode, 1);
  await assert.rejects(initializeLedger(path));
  assert.equal(f.counters().calls, 3);
  await assert.rejects(readFile(join(path, 'budget.json')), { code: 'ENOENT' });
});

test('I004-AC-10 corrupto, inconsistente, marcador ausente y rollback de ledger rechazan sin callback', async (t) => {
  for (const damage of [
    'corrupt',
    'inconsistent',
    'missing-marker',
    'rollback',
    'missing-both-controls',
  ] as const) {
    const path = await directory(t);
    await initializeLedger(path);
    const previous = await readFile(join(path, 'budget.json'));
    if (damage === 'corrupt') {
      await writeFile(join(path, 'budget.json'), '{');
    } else if (damage === 'inconsistent') {
      const ledger = await savedState(path);
      ledger.revision++;
      await writeFile(join(path, 'budget.json'), JSON.stringify(ledger));
    } else if (damage === 'missing-marker') {
      await unlink(join(path, 'budget-initialization.json'));
    } else if (damage === 'missing-both-controls') {
      await unlink(join(path, 'budget-initialization.json'));
      await unlink(join(path, 'budget.json'));
    } else {
      await withLedger(path, async (ledger, save) => {
        reserve(ledger, 'compatibility', 'llama3.1:8b', sha256('protocol'));
        await save();
      });
      await writeFile(join(path, 'budget.json'), previous);
    }
    let entered = false;
    await assert.rejects(
      withLedger(path, async () => {
        entered = true;
      }),
    );
    assert.equal(entered, false);
  }
});

test('I004-AC-10 reserva persistida sin intento o intento sin resultado nunca libera presupuesto', async (t) => {
  for (const attempted of [0, 1]) {
    const path = await directory(t);
    await initializeLedger(path);
    await withLedger(path, async (ledger, save) => {
      const attempt = reserve(ledger, 'compatibility', 'llama3.1:8b', sha256('protocol'));
      await save();
      if (attempted) {
        attempt.attempted++;
        await save();
      }
    });
    const previous = await savedState(path);
    assert.equal(previous.attempts[0].attempted, attempted);
    assert.equal(previous.attempts[0].results.length, 0);
    assert.equal(previous.attempts[0].reserved, 3);
    await assert.rejects(
      withLedger(path, async () => assert.fail('Uncertain budget cannot continue')),
    );
    await assert.rejects(initializeLedger(path));
    assert.deepEqual(await savedState(path), previous);
  }
});

test('I004-AC-10 inicialización permite solo preflight de lectura y bloquea evidencias huérfanas', async (t) => {
  const path = await directory(t);
  await writeFile(
    join(path, 'preflight-readonly-2026-11-06T00-00-00.000Z.json'),
    JSON.stringify({
      mode: 'read_only_preflight',
      inferencesAdded: 0,
      downloads: 0,
      modelsStartedOrStopped: 0,
      permissionsChanged: false,
      requests: [{ method: 'GET', path: '/api/tags' }],
    }),
  );
  await initializeLedger(path);
  for (const name of [
    'old-run.json',
    `${'a'.repeat(64)}.manifest.json`,
    'budget.json-old.tmp',
    'budget-persistence.pending',
  ]) {
    const orphaned = await directory(t);
    await writeFile(join(orphaned, name), '{}');
    await assert.rejects(initializeLedger(orphaned));
  }
  const restoration = await directory(t);
  await initializeLedger(restoration);
  const originalLedger = await readFile(join(restoration, 'budget.json'));
  const originalMarker = await readFile(join(restoration, 'budget-initialization.json'));
  await writeFile(join(restoration, 'old-run.json'), '{}');
  // Even a mutually consistent pair of restored zero-state controls cannot hide orphan evidence.
  await writeFile(join(restoration, 'budget.json'), originalLedger);
  await writeFile(join(restoration, 'budget-initialization.json'), originalMarker);
  await assert.rejects(
    withLedger(restoration, async () => assert.fail('Orphan evidence must block')),
  );
});

test(
  'I004-AC-10 dos procesos concurrentes solo permiten un propietario del lock',
  { timeout: 10000 },
  async (t) => {
    const path = await directory(t);
    await initializeLedger(path);
    const moduleUrl = new URL('../../src/evaluation/model-comparison/budget.js', import.meta.url)
      .href;
    const code = `import {withLedger} from ${JSON.stringify(moduleUrl)};
    await withLedger(process.argv[1], async () => {
      process.stdout.write('LOCKED\\n');
      await new Promise(resolve => process.stdin.once('data', resolve));
    });`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, path], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null) {
        child.kill();
      }
    });
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(() => {
        throw new Error('Child exited before lock acquired');
      }),
    ]);
    await assert.rejects(
      withLedger(path, async () => assert.fail('Concurrent process entered')),
      { code: 'EEXIST' },
    );
    const exited = once(child, 'exit');
    child.stdin.end('release\n');
    const [codeResult] = await exited;
    assert.equal(codeResult, 0);
    await withLedger(path, async (ledger) => assert.equal(ledger.attempts.length, 0));
  },
);

test('I004-AC-10 fallos de sincronización inicial no permiten recuperar estado automáticamente', async (t) => {
  for (const fault of [
    ['file', 3],
    ['directory', 5],
  ] as const) {
    const path = await directory(t);
    await assert.rejects(initializeLedger(path, failingSync(fault[0], fault[1])));
    await assert.rejects(
      withLedger(path, async () => assert.fail('Initialization was not acknowledged')),
    );
    await assert.rejects(initializeLedger(path));
  }
});

test('I004-AC-10 fallos al persistir progreso conservan bloqueo, incluso después del último fsync', async (t) => {
  for (const fault of [
    ['file', 1],
    ['file', 2],
    ['file', 3],
    ['directory', 3],
  ] as const) {
    const path = await directory(t);
    await initializeLedger(path);
    await assert.rejects(
      withLedger(
        path,
        async (ledger, save) => {
          reserve(ledger, 'compatibility', 'llama3.1:8b', sha256('protocol'));
          await save();
        },
        failingSync(fault[0], fault[1]),
      ),
    );
    await assert.rejects(
      withLedger(path, async () => assert.fail('Uncertain persistence cannot continue')),
    );
    await assert.rejects(initializeLedger(path));
  }
});

test('I004-AC-10 persistencia no permite liberar un intento ni reescribir un progreso guardado', async (t) => {
  const path = await directory(t);
  await initializeLedger(path);
  await withLedger(path, async (ledger, save) => {
    const attempt = reserve(ledger, 'compatibility', 'llama3.1:8b', sha256('protocol'));
    attempt.attempted = 1;
    await save();
    attempt.attempted = 0;
    await assert.rejects(save());
  });
  assert.equal((await savedState(path)).attempts[0].attempted, 1);
  await assert.rejects(
    withLedger(path, async () => assert.fail('Incomplete attempt requires review')),
  );
});
