import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Ajv } from 'ajv';
import { persist, locked, synchronization, type DiskSynchronization } from '../durable-files.js';
import { sha256 } from '../dataset.js';
import type { RunControl } from './run.js';
import type { CaseResult, EvaluationDataset, RunIdentity } from './types.js';

export interface Authorization {
  schemaVersion: 1;
  experiment: 'I006';
  datasetReview: 'PENDING_HUMAN_REVIEW' | 'APPROVED_FROZEN';
  datasetHash: string | null;
  initialize: boolean;
  execute: boolean;
  identityHash: string | null;
  approvalReference: string | null;
  maximumInferences: 120;
}

const hash = { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' };
const validate = new Ajv({ strictTypes: false }).compile<Authorization>({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'experiment',
    'datasetReview',
    'datasetHash',
    'initialize',
    'execute',
    'identityHash',
    'approvalReference',
    'maximumInferences',
  ],
  properties: {
    schemaVersion: { const: 1 },
    experiment: { const: 'I006' },
    datasetReview: { enum: ['PENDING_HUMAN_REVIEW', 'APPROVED_FROZEN'] },
    datasetHash: hash,
    initialize: { type: 'boolean' },
    execute: { type: 'boolean' },
    identityHash: hash,
    approvalReference: { type: ['string', 'null'], minLength: 1 },
    maximumInferences: { const: 120 },
  },
});

export async function readAuthorization(path: string): Promise<Authorization> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!validate(value)) {
    throw new Error('Invalid I006 authorization');
  }
  return value;
}

export function requireAuthorization(
  authorization: Authorization,
  identity: RunIdentity,
  phase: 'initialize' | 'execute',
) {
  if (
    authorization.datasetReview !== 'APPROVED_FROZEN' ||
    authorization.datasetHash !== identity.datasetHash ||
    authorization.identityHash !== sha256(JSON.stringify(identity)) ||
    !authorization.approvalReference ||
    !authorization[phase]
  ) {
    throw new Error('I006 phase not authorized for this identity');
  }
}

interface Ledger {
  schemaVersion: 1;
  identityHash: string;
  phase: 'READY' | 'RUNNING' | 'CLOSED';
  runId: string | null;
  reservedSlots: number;
  observedAttempts: number;
  pending: string | null;
  results: CaseResult[];
}

export async function withControl<T>(
  directory: string,
  dataset: EvaluationDataset,
  identity: RunIdentity,
  authorizationPath: string,
  initialize: boolean,
  operation: (control: RunControl) => Promise<T>,
  sync: DiskSynchronization = synchronization,
): Promise<T | undefined> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return locked(directory, async () => {
    const identityHash = sha256(JSON.stringify(identity));
    const authorize = async (phase: 'initialize' | 'execute') =>
      requireAuthorization(await readAuthorization(authorizationPath), identity, phase);
    const markerPath = join(directory, 'initialized.json');
    const ledgerPath = join(directory, 'budget.json');
    if (initialize) {
      await authorize('initialize');
      if (
        (await readdir(directory)).some((name) => name !== 'budget.lock') ||
        (await readdir(dirname(directory))).some((name) => /^[a-f0-9-]{36}-[0-9]+-/.test(name))
      ) {
        throw new Error('Prior I006 evidence prevents initialization');
      }
      // Marker first: an interrupted initialization can never silently reset the ledger.
      await persist(markerPath, JSON.stringify({ schemaVersion: 1, identityHash }), true, sync);
      await persist(
        join(directory, 'initialization-authorization.json'),
        JSON.stringify(await readAuthorization(authorizationPath)),
        true,
        sync,
      );
      const ledger: Ledger = {
        schemaVersion: 1,
        identityHash,
        phase: 'READY',
        runId: null,
        reservedSlots: 0,
        observedAttempts: 0,
        pending: null,
        results: [],
      };
      await persist(ledgerPath, JSON.stringify(ledger), true, sync);
      return undefined;
    }
    await authorize('execute');
    const marker = await readFile(markerPath, 'utf8');
    if (marker !== JSON.stringify({ schemaVersion: 1, identityHash })) {
      throw new Error('I006 marker identity mismatch');
    }
    const ledger: Ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    // A run is single-use. No automatic continuation, even if no response was saved.
    if (
      JSON.stringify(ledger) !==
      JSON.stringify({
        schemaVersion: 1,
        identityHash,
        phase: 'READY',
        runId: null,
        reservedSlots: 0,
        observedAttempts: 0,
        pending: null,
        results: [],
      })
    ) {
      throw new Error('I006 ledger is inconsistent, used or uncertain');
    }
    if (
      (await readdir(directory)).some(
        (name) =>
          ![
            'budget.lock',
            'budget.json',
            'initialized.json',
            'initialization-authorization.json',
          ].includes(name),
      )
    ) {
      throw new Error('Unexpected prior evidence in I006 controls');
    }
    let persistedLedger = JSON.stringify(ledger);
    const verifyControls = async () => {
      if (
        (await readFile(markerPath, 'utf8')) !== marker ||
        (await readFile(ledgerPath, 'utf8')) !== persistedLedger
      ) {
        throw new Error('I006 durable controls changed or disappeared');
      }
    };
    const writeLedger = async () => {
      await verifyControls();
      const bytes = JSON.stringify(ledger);
      await persist(ledgerPath, bytes, false, sync);
      persistedLedger = bytes;
    };
    await persist(
      join(directory, 'execution-authorization.json'),
      JSON.stringify(await readAuthorization(authorizationPath)),
      true,
      sync,
    );
    ledger.phase = 'RUNNING';
    ledger.runId = randomUUID();
    await writeLedger();
    let stopped = false;
    const control: RunControl = {
      runId: ledger.runId,
      async reserve(example) {
        await authorize('execute');
        await verifyControls();
        if (
          stopped ||
          ledger.pending !== null ||
          ledger.phase !== 'RUNNING' ||
          dataset.examples[ledger.results.length]?.id !== example.id ||
          ledger.reservedSlots + 2 > 120
        ) {
          throw new Error('I006 reservation blocked');
        }
        ledger.pending = example.id;
        ledger.reservedSlots += 2;
        await writeLedger();
      },
      async record(result) {
        if (
          ledger.pending !== result.id ||
          result.observation.inferenceCount < 1 ||
          result.observation.inferenceCount > 2
        ) {
          throw new Error('I006 result does not match reservation');
        }
        await persist(join(directory, `${result.id}.json`), JSON.stringify(result), true, sync);
        ledger.results.push(result);
        ledger.observedAttempts += result.observation.inferenceCount;
        ledger.pending = null;
        stopped = result.outcome === 'TECHNICAL_ERROR';
        await writeLedger();
      },
    };
    try {
      return await operation(control);
    } finally {
      // Do not clear pending reservations, decrement consumption or reopen a used run.
      ledger.phase = 'CLOSED';
      await writeLedger();
    }
  });
}
