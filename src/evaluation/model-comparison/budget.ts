import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { sha256 } from '../dataset.js';
import { join, dirname } from 'node:path';
import { Ajv } from 'ajv';
import { objectSchema, hashSchema, models, phases, type Model, type Phase } from './protocol.js';
import type { EvaluationResult } from '../types.js';

export interface Attempt {
  id: string;
  phase: Phase;
  model: Model;
  protocolSha256: string;
  reserved: number;
  attempted: number;
  results: EvaluationResult[];
  status: 'reserved' | 'completed' | 'incomplete';
  allowsNext: boolean;
  reportId: string | null;
  reportSha256: string | null;
}

export interface Ledger {
  schemaVersion: 1;
  experimentId: 'I004';
  instanceId: string;
  revision: number;
  attempts: Attempt[];
}

export const resultSchema = objectSchema({
  id: { type: 'string', minLength: 1 },
  expectedCategory: { enum: ['BUG', 'FEATURE', 'QUESTION'] },
  difficulty: { enum: ['obvious', 'complex', 'adversarial'] },
  tags: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
  durationMs: { type: 'number', minimum: 0 },
  status: { enum: ['correct', 'incorrect', 'error'] },
});

// The two variants keep error information separate from predictions and reject raw text.
export const evaluationResultSchema = {
  oneOf: [
    objectSchema({
      ...resultSchema.properties,
      status: { enum: ['correct', 'incorrect'] },
      predictedCategory: { enum: ['BUG', 'FEATURE', 'QUESTION'] },
    }),
    objectSchema({
      ...resultSchema.properties,
      status: { const: 'error' },
      errorKind: {
        enum: ['timeout', 'connection_error', 'http_error', 'invalid_response', 'unexpected_error'],
      },
    }),
  ],
};
const validateSchema = new Ajv().compile<Ledger>(
  objectSchema({
    schemaVersion: { const: 1 },
    experimentId: { const: 'I004' },
    instanceId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    revision: { type: 'integer', minimum: 0 },
    attempts: {
      type: 'array',
      maxItems: 4,
      items: objectSchema({
        id: { type: 'string', minLength: 1 },
        phase: { enum: phases },
        model: { enum: models },
        protocolSha256: hashSchema,
        reserved: { enum: [3, 60] },
        attempted: { type: 'integer', minimum: 0, maximum: 60 },
        results: { type: 'array', maxItems: 60, items: evaluationResultSchema },
        status: { enum: ['reserved', 'completed', 'incomplete'] },
        allowsNext: { type: 'boolean' },
        reportId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        reportSha256: { anyOf: [hashSchema, { type: 'null' }] },
      }),
    },
  }),
);

const order = phases.flatMap((phase) => models.map((model) => ({ phase, model })));

export function validateLedger(value: unknown): asserts value is Ledger {
  if (!validateSchema(value)) {
    throw new Error('Ledger I004 inválido.');
  }
  for (const [index, attempt] of value.attempts.entries()) {
    const expected = order[index]!;
    if (
      attempt.phase !== expected.phase ||
      attempt.model !== expected.model ||
      attempt.reserved !== (attempt.phase === 'compatibility' ? 3 : 60) ||
      attempt.attempted > attempt.reserved ||
      attempt.results.length > attempt.attempted ||
      new Set(attempt.results.map((r) => r.id)).size !== attempt.results.length ||
      (index > 0 &&
        (!value.attempts[index - 1]!.allowsNext ||
          value.attempts[index - 1]!.status !== 'completed')) ||
      (attempt.status === 'completed' &&
        (attempt.attempted !== attempt.reserved ||
          attempt.results.length !== attempt.reserved ||
          !attempt.reportId ||
          !attempt.reportSha256)) ||
      (attempt.allowsNext && attempt.status !== 'completed') ||
      (attempt.phase === 'compatibility' &&
        attempt.allowsNext &&
        attempt.results.some((r) => r.status === 'error')) ||
      (index > 0 && attempt.protocolSha256 !== value.attempts[0]!.protocolSha256)
    ) {
      throw new Error('Orden, progreso o historial I004 inconsistente.');
    }
  }
  if (
    new Set(value.attempts.map((a) => a.id)).size !== value.attempts.length ||
    value.attempts.reduce((sum, a) => sum + a.reserved, 0) > 126
  ) {
    throw new Error('Presupuesto I004 inconsistente.');
  }
}

export function reserve(
  ledger: Ledger,
  phase: Phase,
  model: Model,
  protocolSha256: string,
): Attempt {
  validateLedger(ledger);
  const next = order[ledger.attempts.length];
  if (
    !next ||
    next.phase !== phase ||
    next.model !== model ||
    ledger.attempts.some(
      (a) => a.status !== 'completed' || !a.allowsNext || a.protocolSha256 !== protocolSha256,
    )
  ) {
    throw new Error('Brazo duplicado, fuera de orden o bloqueado por parcialidad.');
  }
  const attempt: Attempt = {
    id: randomUUID(),
    phase,
    model,
    protocolSha256,
    reserved: phase === 'compatibility' ? 3 : 60,
    attempted: 0,
    results: [],
    status: 'reserved',
    allowsNext: false,
    reportId: null,
    reportSha256: null,
  };
  ledger.attempts.push(attempt);
  return attempt;
}

export interface DiskSynchronization {
  file: (handle: FileHandle) => Promise<void>;
  directory: (path: string) => Promise<void>;
}

const synchronization: DiskSynchronization = {
  async file(handle) {
    await handle.sync();
  },
  async directory(path) {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

interface Initialization {
  schemaVersion: 1;
  experimentId: 'I004';
  instanceId: string;
  initializedAt: string;
  state: 'initializing' | 'ready';
  revision: number;
  ledgerSha256: string | null;
}

const validateInitialization = new Ajv().compile<Initialization>(
  objectSchema({
    schemaVersion: { const: 1 },
    experimentId: { const: 'I004' },
    instanceId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    initializedAt: { type: 'string', minLength: 1 },
    state: { enum: ['initializing', 'ready'] },
    revision: { type: 'integer', minimum: 0 },
    ledgerSha256: { anyOf: [hashSchema, { type: 'null' }] },
  }),
);

async function persist(path: string, bytes: string, exclusive: boolean, sync: DiskSynchronization) {
  const target = exclusive ? path : `${path}-${randomUUID()}.tmp`;
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await sync.file(handle);
  } finally {
    await handle.close();
  }
  if (!exclusive) {
    await rename(target, path);
  }
  await sync.directory(dirname(path));
}

async function locked<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const path = join(directory, 'budget.lock');
  const handle = await open(path, 'wx', 0o600);
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(path);
  }
}

async function isReadOnlyPreflight(directory: string, name: string) {
  if (!/^preflight-readonly-[0-9TZ.:-]+\.json$/.test(name)) {
    return false;
  }
  const value = JSON.parse(await readFile(join(directory, name), 'utf8'));
  const paths = ['/api/version', '/api/tags', '/api/ps', '/api/show'];
  return (
    value.mode === 'read_only_preflight' &&
    value.inferencesAdded === 0 &&
    value.downloads === 0 &&
    value.modelsStartedOrStopped === 0 &&
    value.permissionsChanged === false &&
    Array.isArray(value.requests) &&
    value.requests.every(
      (request: { method: string; path: string }) =>
        paths.includes(request.path) &&
        (request.method === 'GET' || (request.method === 'POST' && request.path === '/api/show')),
    )
  );
}

async function auditEvidence(directory: string, ledger: Ledger | null) {
  const controls = new Set(['budget.lock', 'budget.json', 'budget-initialization.json']);
  const reports = new Map(
    ledger?.attempts.filter((a) => a.reportId).map((a) => [`${a.reportId}.json`, a.reportSha256]) ??
      [],
  );
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      throw new Error('Artefacto I004 no reconocido; requiere revisión.');
    }
    const name = entry.name;
    if (name === 'budget.lock' || (ledger && controls.has(name))) {
      continue;
    }
    if (await isReadOnlyPreflight(directory, name)) {
      continue;
    }
    const path = join(directory, name);
    if (ledger && reports.has(name) && sha256(await readFile(path)) === reports.get(name)) {
      continue;
    }
    const snapshot = /^([a-f0-9]{64})\.manifest\.json$/.exec(name);
    if (
      ledger &&
      ledger.attempts.length > 0 &&
      snapshot &&
      sha256(await readFile(path)) === snapshot[1]
    ) {
      continue;
    }
    throw new Error('Evidencia huérfana o incompatible; no se reinicia presupuesto.');
  }
  for (const [name, hash] of reports) {
    if (sha256(await readFile(join(directory, name))) !== hash) {
      throw new Error('Falta evidencia de un brazo registrado.');
    }
  }
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
    // A read-only preflight is not a previous inference experiment. All other
    // evidence, including old controls or temporary writes, blocks initialization.
    await auditEvidence(directory, null);
    const pendingPath = join(directory, 'budget-persistence.pending');
    await persist(pendingPath, 'initialization pending\n', true, sync);
    const instanceId = randomUUID();
    const marker: Initialization = {
      schemaVersion: 1,
      experimentId: 'I004',
      instanceId,
      initializedAt: new Date().toISOString(),
      state: 'initializing',
      revision: 0,
      ledgerSha256: null,
    };
    const markerPath = join(directory, 'budget-initialization.json');
    await persist(markerPath, encode(marker), true, sync);
    const ledger: Ledger = {
      schemaVersion: 1,
      experimentId: 'I004',
      instanceId,
      revision: 0,
      attempts: [],
    };
    const bytes = encode(ledger);
    await persist(join(directory, 'budget.json'), bytes, true, sync);
    marker.state = 'ready';
    marker.ledgerSha256 = sha256(bytes);
    await persist(markerPath, encode(marker), false, sync);
    // Data and directory entries are already synced. A lost cleanup can only
    // resurrect this sentinel and block, never restore unused budget.
    await unlink(pendingPath);
    return { instanceId, reserved: 0, attempted: 0 };
  });
}

async function readState(directory: string) {
  // Missing files never imply a fresh experiment. Initialization is a separate operation.
  const marker: unknown = JSON.parse(
    await readFile(join(directory, 'budget-initialization.json'), 'utf8'),
  );
  const bytes = await readFile(join(directory, 'budget.json'));
  const ledger: unknown = JSON.parse(bytes.toString('utf8'));
  validateLedger(ledger);
  if (
    !validateInitialization(marker) ||
    marker.state !== 'ready' ||
    !Number.isFinite(Date.parse(marker.initializedAt)) ||
    marker.instanceId !== ledger.instanceId ||
    marker.revision !== ledger.revision ||
    marker.ledgerSha256 !== sha256(bytes)
  ) {
    throw new Error('Inicialización o persistencia incierta; requiere revisión humana.');
  }
  return { marker, ledger };
}

function requireMonotonic(previous: Ledger, next: Ledger) {
  if (
    next.instanceId !== previous.instanceId ||
    next.revision !== previous.revision ||
    next.attempts.length < previous.attempts.length ||
    next.attempts.length > previous.attempts.length + 1
  ) {
    throw new Error('No se permite restaurar o liberar presupuesto.');
  }
  for (const [index, before] of previous.attempts.entries()) {
    const after = next.attempts[index]!;
    if (
      before.id !== after.id ||
      before.phase !== after.phase ||
      before.model !== after.model ||
      before.protocolSha256 !== after.protocolSha256 ||
      before.reserved !== after.reserved ||
      after.attempted < before.attempted ||
      after.results.length < before.results.length ||
      !isDeepStrictEqual(before.results, after.results.slice(0, before.results.length)) ||
      (before.status !== 'reserved' && !isDeepStrictEqual(before, after))
    ) {
      throw new Error('Progreso reescrito o presupuesto incierto.');
    }
  }
}

export async function withLedger<T>(
  directory: string,
  operation: (ledger: Ledger, save: () => Promise<void>) => Promise<T>,
  sync: DiskSynchronization = synchronization,
): Promise<T> {
  return locked(directory, async () => {
    let current = await readState(directory);
    await auditEvidence(directory, current.ledger);
    if (
      current.ledger.attempts.some(
        (attempt) => attempt.status !== 'completed' || !attempt.allowsNext,
      )
    ) {
      throw new Error('Existe una reserva o intento incierto; no se continúa.');
    }
    const ledger = structuredClone(current.ledger);
    let persistenceFailed = false;
    return operation(ledger, async () => {
      if (persistenceFailed) {
        throw new Error('Persistencia fallida; no se intenta recuperación automática.');
      }
      try {
        const observed = await readState(directory);
        if (!isDeepStrictEqual(observed, current)) {
          throw new Error('Control de presupuesto cambiado durante ejecución.');
        }
        validateLedger(ledger);
        requireMonotonic(current.ledger, ledger);
        await auditEvidence(directory, ledger);
        const pendingPath = join(directory, 'budget-persistence.pending');
        await persist(pendingPath, 'budget update pending\n', true, sync);
        const next = { ...ledger, revision: current.ledger.revision + 1 };
        const bytes = encode(next);
        await persist(join(directory, 'budget.json'), bytes, false, sync);
        const marker = { ...current.marker, revision: next.revision, ledgerSha256: sha256(bytes) };
        await persist(join(directory, 'budget-initialization.json'), encode(marker), false, sync);
        await unlink(pendingPath);
        ledger.revision = next.revision;
        current = { marker, ledger: structuredClone(next) };
      } catch (error) {
        persistenceFailed = true;
        throw error;
      }
    });
  });
}
