import { readFileSync } from 'node:fs';
import { classificationProtocolId } from './protocol.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Ajv } from 'ajv';
import { persist, locked, synchronization, type DiskSynchronization } from '../durable-files.js';
import { sha256 } from '../dataset.js';
import type { RunControl } from './run.js';
import type {
  CaseResult,
  EvaluationDataset,
  RunIdentity,
  InferencePhase,
  EvaluationCase,
  AttemptAccounting,
} from './types.js';

export interface Authorization {
  schemaVersion: 2;
  protocolId: typeof classificationProtocolId;
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
    'protocolId',
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
    schemaVersion: { const: 2 },
    protocolId: { const: classificationProtocolId },
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
    authorization.protocolId !== classificationProtocolId ||
    identity.protocolId !== classificationProtocolId ||
    authorization.datasetReview !== 'APPROVED_FROZEN' ||
    authorization.datasetHash !== identity.datasetHash ||
    authorization.identityHash !== sha256(JSON.stringify(identity)) ||
    !authorization.approvalReference ||
    !authorization[phase]
  ) {
    throw new Error('I006 phase not authorized for this identity');
  }
}

export interface DurableRunControl extends RunControl {
  attempt(example: EvaluationCase, phase: InferencePhase): Promise<void>;
  verifyDispatch(example: EvaluationCase): void;
  dispatch(example: EvaluationCase): void;
  accounting(example: EvaluationCase): AttemptAccounting;
}

interface Ledger {
  schemaVersion: 2;
  attempts: { id: string; phase: InferencePhase }[];
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
  operation: (control: DurableRunControl) => Promise<T>,
  sync: DiskSynchronization = synchronization,
): Promise<T | undefined> {
  requireAuthorization(
    await readAuthorization(authorizationPath),
    identity,
    initialize ? 'initialize' : 'execute',
  );
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
      await persist(markerPath, JSON.stringify({ schemaVersion: 2, identityHash }), true, sync);
      await persist(
        join(directory, 'initialization-authorization.json'),
        JSON.stringify(await readAuthorization(authorizationPath)),
        true,
        sync,
      );
      const ledger: Ledger = {
        schemaVersion: 2,
        identityHash,
        phase: 'READY',
        runId: null,
        attempts: [],
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
    if (marker !== JSON.stringify({ schemaVersion: 2, identityHash })) {
      throw new Error('I006 marker identity mismatch');
    }
    const ledger: Ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    // A run is single-use. No automatic continuation, even if no response was saved.
    if (
      JSON.stringify(ledger) !==
      JSON.stringify({
        schemaVersion: 2,
        identityHash,
        phase: 'READY',
        runId: null,
        attempts: [],
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
    let reservingAttempt = false;
    const accountingById = new Map<string, AttemptAccounting>();
    const accountingFor = (example: EvaluationCase): AttemptAccounting => {
      let accounting = accountingById.get(example.id);
      if (!accounting) {
        accounting = {
          decision: { reserved: 0, dispatched: 0, reservationUncertain: false },
          classification: { reserved: 0, dispatched: 0, reservationUncertain: false },
        };
        accountingById.set(example.id, accounting);
      }
      return accounting;
    };
    const control: DurableRunControl = {
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
      async attempt(example, phase) {
        if (reservingAttempt) {
          stopped = true;
          throw new Error('Concurrent inference reservation');
        }
        reservingAttempt = true;
        try {
          await authorize('execute');
          await verifyControls();
          const previous = ledger.attempts.filter((attempt) => attempt.id === example.id);
          if (
            stopped ||
            ledger.pending !== example.id ||
            ledger.phase !== 'RUNNING' ||
            ledger.observedAttempts >= 120 ||
            previous.length >= 2 ||
            phase !== (previous.length === 0 ? 'decision' : 'classification')
          ) {
            throw new Error('Inference attempt blocked');
          }
          const accounting = accountingFor(example)[phase];
          // A failed write may leave a journal; its uncertainty must never permit a retry.
          accounting.reservationUncertain = true;
          await persist(
            join(directory, `${example.id}-${phase}.json`),
            JSON.stringify({ id: example.id, phase, state: 'RESERVED_POSSIBLE_DISPATCH' }),
            true,
            sync,
          );
          ledger.attempts.push({ id: example.id, phase });
          ledger.observedAttempts++;
          await writeLedger();
          accounting.reserved = 1;
          accounting.reservationUncertain = false;
          if (stopped) {
            throw new Error('Inference reservation invalidated');
          }
        } catch (error) {
          stopped = true;
          throw error;
        } finally {
          reservingAttempt = false;
        }
      },
      verifyDispatch(example) {
        const authorization: unknown = JSON.parse(readFileSync(authorizationPath, 'utf8'));
        if (!validate(authorization)) {
          throw new Error('Invalid inference authorization');
        }
        requireAuthorization(authorization, identity, 'execute');
        if (
          stopped ||
          ledger.phase !== 'RUNNING' ||
          ledger.pending !== example.id ||
          ledger.attempts.at(-1)?.id !== example.id ||
          readFileSync(markerPath, 'utf8') !== marker ||
          readFileSync(ledgerPath, 'utf8') !== persistedLedger
        ) {
          throw new Error('Durable inference controls changed');
        }
      },
      accounting(example) {
        return structuredClone(accountingFor(example));
      },
      dispatch(example) {
        control.verifyDispatch(example);
        const last = ledger.attempts.at(-1)!;
        const accounting = accountingFor(example)[last.phase];
        if (
          accounting.reserved !== 1 ||
          accounting.reservationUncertain ||
          accounting.dispatched !== 0
        ) {
          stopped = true;
          throw new Error('Unreserved or repeated dispatch');
        }
        accounting.dispatched = 1;
      },
      async record(result) {
        await verifyControls();
        const example = dataset.examples[ledger.results.length];
        const accounting = example ? accountingFor(example) : undefined;
        const isControlFailure =
          result.outcome === 'TECHNICAL_ERROR' &&
          result.error === 'control_error' &&
          result.failurePhase === 'control' &&
          result.final === null &&
          result.observation.toolDecisionCorrect === null;
        const failedBeforeCaseReservation =
          ledger.pending === null &&
          isControlFailure &&
          Object.values(result.phases).every(
            (phase) =>
              !phase.started &&
              phase.status === 'NOT_STARTED' &&
              phase.attempts === 0 &&
              phase.dispatched === 0 &&
              !phase.reservationUncertain,
          );
        if (
          example?.id !== result.id ||
          !accounting ||
          (ledger.pending !== result.id && !failedBeforeCaseReservation) ||
          result.observation.inferenceCount < 0 ||
          result.observation.inferenceCount > 2 ||
          (result.observation.inferenceCount === 0 && !isControlFailure) ||
          ledger.attempts.filter((attempt) => attempt.id === result.id).length !==
            result.observation.inferenceCount ||
          result.phases.decision.attempts + result.phases.classification.attempts !==
            result.observation.inferenceCount ||
          (['decision', 'classification'] as const).some(
            (phase) =>
              result.phases[phase].attempts !== accounting[phase].reserved ||
              result.phases[phase].dispatched !== accounting[phase].dispatched ||
              result.phases[phase].reservationUncertain !==
                accounting[phase].reservationUncertain ||
              (accounting[phase].reserved > 0 && !result.phases[phase].started) ||
              !result.phases[phase].started !== (result.phases[phase].status === 'NOT_STARTED'),
          )
        ) {
          throw new Error('I006 result does not match reservation');
        }
        await persist(join(directory, `${result.id}.json`), JSON.stringify(result), true, sync);
        ledger.results.push(result);
        if (result.error !== 'control_error') {
          ledger.pending = null;
        }
        stopped = stopped || result.outcome === 'TECHNICAL_ERROR';
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
