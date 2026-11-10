import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Ajv } from 'ajv';
import { persist, locked, synchronization, type DiskSynchronization } from '../durable-files.js';
import { sha256 } from '../dataset.js';
import { evaluationResultSchema } from '../model-comparison/budget.js';
import { objectSchema, hashSchema } from '../model-comparison/protocol.js';
import {
  models,
  validateOperation,
  protocolHash,
  approved,
  type Model,
  type Operation,
} from './protocol.js';
import type { EvaluationResult } from '../types.js';

export interface Attempt {
  id: string;
  model: Model;
  protocolSha256: string;
  reserved: 90;
  operationSha256: string;
  operationBytes: number;
  permissionClosed: boolean;
  attempted: number;
  results: EvaluationResult[];
  status: 'reserved' | 'completed' | 'incomplete';
  reportId: string | null;
  reportSha256: string | null;
}

export interface Ledger {
  schemaVersion: 1;
  experimentId: 'I005';
  instanceId: string;
  revision: number;
  attempts: Attempt[];
}

const nullable = (s: unknown) => ({ anyOf: [s, { type: 'null' }] });
const validateSchema = new Ajv().compile<Ledger>(
  objectSchema({
    schemaVersion: { const: 1 },
    experimentId: { const: 'I005' },
    instanceId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    revision: { type: 'integer', minimum: 0 },
    attempts: {
      type: 'array',
      maxItems: 2,
      items: objectSchema({
        id: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
        model: { enum: models },
        protocolSha256: hashSchema,
        reserved: { const: 90 },
        operationSha256: hashSchema,
        operationBytes: { type: 'integer', minimum: 1 },
        permissionClosed: { type: 'boolean' },
        attempted: { type: 'integer', minimum: 0, maximum: 90 },
        results: { type: 'array', maxItems: 90, items: evaluationResultSchema },
        status: { enum: ['reserved', 'completed', 'incomplete'] },
        reportId: nullable({ type: 'string', pattern: '^[a-f0-9-]{36}$' }),
        reportSha256: nullable(hashSchema),
      }),
    },
  }),
);

export function validateLedger(value: unknown): asserts value is Ledger {
  if (!validateSchema(value)) {
    throw new Error('Ledger I005 inválido.');
  }
  for (const [i, a] of value.attempts.entries()) {
    if (
      a.model !== models[i] ||
      a.results.length > a.attempted ||
      a.attempted - a.results.length > 1 ||
      new Set(a.results.map((r) => r.id)).size !== a.results.length ||
      a.results.some(
        (r) =>
          r.status !== 'error' &&
          (r.status === 'correct') !== (r.predictedCategory === r.expectedCategory),
      ) ||
      (a.status !== 'reserved' && !a.permissionClosed) ||
      (a.status === 'reserved' && a.permissionClosed) ||
      (a.status === 'completed' &&
        (a.results.length !== 90 || a.attempted !== 90 || !a.reportId || !a.reportSha256)) ||
      (i > 0 &&
        (value.attempts[i - 1]!.status !== 'completed' ||
          a.protocolSha256 !== value.attempts[0]!.protocolSha256))
    ) {
      throw new Error('Progreso I005 inconsistente.');
    }
  }
  if (new Set(value.attempts.map((a) => a.id)).size !== value.attempts.length) {
    throw new Error('Reserva duplicada.');
  }
}

interface Marker {
  experimentId: 'I005';
  instanceId: string;
  initializedAt: string;
  revision: number;
  ledgerSha256: string;
}

const validateMarker = new Ajv().compile<Marker>(
  objectSchema({
    experimentId: { const: 'I005' },
    instanceId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    initializedAt: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 0 },
    ledgerSha256: hashSchema,
  }),
);

export async function auditEvidence(directory: string, ledger: Ledger, lockAllowed = false) {
  const permitted = new Map<string, string>();
  for (const a of ledger.attempts) {
    const name = `${a.operationSha256}.operation.json`;
    const bytes = await readFile(join(directory, name));
    const operation: unknown = JSON.parse(bytes.toString('utf8'));
    validateOperation(operation);
    if (
      sha256(bytes) !== a.operationSha256 ||
      bytes.length !== a.operationBytes ||
      protocolHash(operation) !== a.protocolSha256
    ) {
      throw new Error('Snapshot obligatorio ausente o divergente.');
    }
    permitted.set(name, a.operationSha256);
    if (a.reportId) {
      const reportName = `${a.reportId}.json`;
      const raw = await readFile(join(directory, reportName));
      const r = JSON.parse(raw.toString('utf8'));
      if (
        sha256(raw) !== a.reportSha256 ||
        r.runId !== a.reportId ||
        r.reservationId !== a.id ||
        r.operationSha256 !== a.operationSha256 ||
        !isDeepStrictEqual(r.operation, operation) ||
        r.protocolSha256 !== a.protocolSha256 ||
        r.model?.name !== a.model ||
        !isDeepStrictEqual(r.results, a.results)
      ) {
        throw new Error('Informe y snapshot divergentes.');
      }
      permitted.set(reportName, a.reportSha256!);
    }
  }
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!item.isFile()) {
      throw new Error('Evidencia desconocida.');
    }
    if (
      ['budget.json', 'budget-initialization.json'].includes(item.name) ||
      (lockAllowed && item.name === 'budget.lock')
    ) {
      continue;
    }
    if (
      !permitted.has(item.name) ||
      sha256(await readFile(join(directory, item.name))) !== permitted.get(item.name)
    ) {
      throw new Error('Evidencia huérfana o persistencia incierta.');
    }
  }
}

async function readState(directory: string) {
  const bytes = await readFile(join(directory, 'budget.json'));
  const ledger: unknown = JSON.parse(bytes.toString('utf8'));
  const marker: unknown = JSON.parse(
    await readFile(join(directory, 'budget-initialization.json'), 'utf8'),
  );
  validateLedger(ledger);
  if (
    !validateMarker(marker) ||
    marker.instanceId !== ledger.instanceId ||
    marker.revision !== ledger.revision ||
    marker.ledgerSha256 !== sha256(bytes) ||
    !Number.isFinite(Date.parse(marker.initializedAt))
  ) {
    throw new Error('Controles I005 divergentes.');
  }
  return { ledger, marker };
}

export async function readLedger(directory: string, lockAllowed = false) {
  const state = await readState(directory);
  await auditEvidence(directory, state.ledger, lockAllowed);
  return state;
}

function encode(value: unknown) {
  return JSON.stringify(value, null, 2) + '\n';
}

export async function initializeLedger(
  directory: string,
  sync: DiskSynchronization = synchronization,
) {
  await mkdir(directory, { recursive: true });
  await sync.directory(dirname(directory));
  return locked(directory, async () => {
    if ((await readdir(directory)).some((name) => name !== 'budget.lock')) {
      throw new Error('Inicialización solo para experimento nuevo y vacío.');
    }
    const pending = join(directory, 'budget-persistence.pending');
    await persist(pending, 'initialization pending\n', true, sync);
    const ledger: Ledger = {
      schemaVersion: 1,
      experimentId: 'I005',
      instanceId: randomUUID(),
      revision: 0,
      attempts: [],
    };
    const bytes = encode(ledger);
    const marker: Marker = {
      experimentId: 'I005',
      instanceId: ledger.instanceId,
      initializedAt: new Date().toISOString(),
      revision: 0,
      ledgerSha256: sha256(bytes),
    };
    await persist(join(directory, 'budget.json'), bytes, true, sync);
    await persist(join(directory, 'budget-initialization.json'), encode(marker), true, sync);
    await unlink(pending);
    return { reserved: 0, attempted: 0 };
  });
}

function monotonic(before: Ledger, after: Ledger) {
  if (
    before.instanceId !== after.instanceId ||
    before.revision !== after.revision ||
    after.attempts.length < before.attempts.length ||
    after.attempts.length > before.attempts.length + 1
  ) {
    throw new Error('No se restaura presupuesto.');
  }
  for (const [i, a] of before.attempts.entries()) {
    const b = after.attempts[i]!;
    if (a.status !== 'reserved' && !isDeepStrictEqual(a, b)) {
      throw new Error('Brazo final reescrito.');
    }
    if (
      a.id !== b.id ||
      a.model !== b.model ||
      a.protocolSha256 !== b.protocolSha256 ||
      a.reserved !== b.reserved ||
      a.operationSha256 !== b.operationSha256 ||
      a.operationBytes !== b.operationBytes ||
      (a.permissionClosed && !b.permissionClosed) ||
      b.attempted < a.attempted ||
      b.attempted > a.attempted + 1 ||
      b.results.length < a.results.length ||
      b.results.length > a.results.length + 1 ||
      !isDeepStrictEqual(a.results, b.results.slice(0, a.results.length))
    ) {
      throw new Error('Intentos o resultados reescritos.');
    }
  }
}

export async function withLedger<T>(
  directory: string,
  operation: (ledger: Ledger, save: () => Promise<void>) => Promise<T>,
  sync: DiskSynchronization = synchronization,
) {
  return locked(directory, async () => {
    let current = await readLedger(directory, true);
    if (current.ledger.attempts.some((a) => a.status !== 'completed')) {
      throw new Error('Reserva o intento incierto; no se continúa.');
    }
    const ledger = structuredClone(current.ledger);
    let failed = false;
    return operation(ledger, async () => {
      if (failed) {
        throw new Error('Persistencia fallida, sin recuperación automática.');
      }
      try {
        if (!isDeepStrictEqual(await readState(directory), current)) {
          throw new Error('Controles cambiados durante ejecución.');
        }
        validateLedger(ledger);
        monotonic(current.ledger, ledger);
        await auditEvidence(directory, ledger, true);
        const sentinel = join(directory, 'budget-persistence.pending');
        await persist(sentinel, 'update pending\n', true, sync);
        const next = { ...ledger, revision: ledger.revision + 1 };
        const bytes = encode(next);
        const marker = { ...current.marker, revision: next.revision, ledgerSha256: sha256(bytes) };
        await persist(join(directory, 'budget.json'), bytes, false, sync);
        await persist(join(directory, 'budget-initialization.json'), encode(marker), false, sync);
        await unlink(sentinel);
        ledger.revision = next.revision;
        current = { ledger: structuredClone(next), marker };
      } catch (error) {
        failed = true;
        throw error;
      }
    });
  });
}

export function reserve(
  ledger: Ledger,
  model: Model,
  protocolSha256: string,
  snapshot: { sha256: string; bytes: number },
): Attempt {
  validateLedger(ledger);
  if (
    models[ledger.attempts.length] !== model ||
    ledger.attempts.some((a) => a.status !== 'completed' || a.protocolSha256 !== protocolSha256)
  ) {
    throw new Error('Duplicado, fuera de orden o incompleto.');
  }
  const attempt: Attempt = {
    id: randomUUID(),
    model,
    protocolSha256,
    reserved: 90,
    operationSha256: snapshot.sha256,
    operationBytes: snapshot.bytes,
    permissionClosed: false,
    attempted: 0,
    results: [],
    status: 'reserved',
    reportId: null,
    reportSha256: null,
  };
  ledger.attempts.push(attempt);
  return attempt;
}

/** Approval declarations are retained; consumed permissions are irreversibly closed in the ledger. */
export function effectiveAuthorization(operation: Operation, ledger: Ledger) {
  return Object.fromEntries(
    Object.entries(operation.authorization).map(([action, approval]) => [
      action,
      {
        ...approval,
        approved:
          approved(operation.identityApproval) &&
          approved(approval) &&
          !ledger.attempts.some((a) => a.status !== 'completed') &&
          (action !== 'gemma3:12b' ||
            (ledger.attempts[0]?.status === 'completed' &&
              approved(operation.llamaReview) &&
              operation.llamaReview.reportSha256 === ledger.attempts[0].reportSha256)) &&
          (action === 'initialize' ? false : !ledger.attempts.some((a) => a.model === action)),
      },
    ]),
  );
}
