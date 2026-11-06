import { randomUUID } from 'node:crypto';
import { open, readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { RegisteredPrompt } from './prompts.js';
import type { Phase } from './experiment-manifest.js';
import { Ajv } from 'ajv';

export interface BudgetAttempt {
  id: string;
  promptId: string;
  promptVersion: number;
  promptSha256: string;
  role: RegisteredPrompt['role'];
  phase: Phase;
  datasetSha256: string;
  protocolSha256: string;
  plannedInferences: 60;
  status: 'reserved' | 'completed' | 'incomplete';
  reportRunId: string | null;
}

export interface ExperimentLedger {
  schemaVersion: 1;
  attempts: BudgetAttempt[];
}

const validateLedgerSchema = new Ajv().compile<ExperimentLedger>({
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'attempts'],
  properties: {
    schemaVersion: { const: 1 },
    attempts: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'promptId',
          'promptVersion',
          'promptSha256',
          'role',
          'phase',
          'datasetSha256',
          'protocolSha256',
          'plannedInferences',
          'status',
          'reportRunId',
        ],
        properties: {
          id: { type: 'string', minLength: 1 },
          promptId: { type: 'string', minLength: 1 },
          promptVersion: { type: 'integer', minimum: 1 },
          promptSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          role: { enum: ['baseline', 'candidate'] },
          phase: { enum: ['development', 'validation'] },
          datasetSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          protocolSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          plannedInferences: { const: 60 },
          status: { enum: ['reserved', 'completed', 'incomplete'] },
          reportRunId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        },
      },
    },
  },
});

export function validateLedger(ledger: unknown): asserts ledger is ExperimentLedger {
  if (!validateLedgerSchema(ledger)) {
    throw new Error('Registro de presupuesto inválido.');
  }

  const candidates = ledger.attempts.filter((attempt) => attempt.role === 'candidate');
  const keys = ledger.attempts.map(
    (attempt) =>
      `${attempt.phase}:${attempt.role === 'baseline' ? 'baseline' : attempt.promptSha256}`,
  );

  if (
    new Set(ledger.attempts.map((attempt) => attempt.id)).size !== ledger.attempts.length ||
    new Set(keys).size !== keys.length ||
    new Set(candidates.map((attempt) => attempt.promptSha256)).size > 5 ||
    ledger.attempts.filter((attempt) => attempt.phase === 'development').length > 6 ||
    ledger.attempts.filter((attempt) => attempt.phase === 'validation').length > 2 ||
    candidates.filter((attempt) => attempt.phase === 'validation').length > 1 ||
    ledger.attempts.filter((attempt) => attempt.status === 'reserved').length > 1
  ) {
    throw new Error('Historial de presupuesto inconsistente.');
  }
}

export function reserveAttempt(
  ledger: ExperimentLedger,
  prompt: RegisteredPrompt,
  phase: Phase,
  datasetSha256: string,
  protocolSha256: string,
): BudgetAttempt {
  validateLedger(ledger);

  if (ledger.attempts.some((attempt) => attempt.status === 'reserved')) {
    throw new Error(
      'Existe una reserva pendiente; requiere revisión humana, sin reintentos automáticos.',
    );
  }

  if (
    ledger.attempts.length >= 8 ||
    ledger.attempts.reduce((sum, attempt) => sum + attempt.plannedInferences, 0) + 60 > 480 ||
    ledger.attempts.filter((attempt) => attempt.phase === phase).length >=
      (phase === 'development' ? 6 : 2)
  ) {
    throw new Error('Presupuesto experimental agotado.');
  }

  if (
    ledger.attempts.some(
      (attempt) =>
        attempt.phase === phase &&
        (attempt.promptSha256 === prompt.sha256 ||
          (attempt.role === 'baseline' && prompt.role === 'baseline')),
    )
  ) {
    throw new Error('No se permiten repeticiones de un brazo.');
  }

  if (
    ledger.attempts.some(
      (attempt) => attempt.phase === phase && attempt.protocolSha256 !== protocolSha256,
    )
  ) {
    throw new Error('El protocolo o los objetivos inducidos cambiaron dentro de la fase.');
  }

  const candidateAttempts = ledger.attempts.filter((attempt) => attempt.role === 'candidate');
  const hashes = new Set(candidateAttempts.map((attempt) => attempt.promptSha256));

  if (prompt.role === 'candidate') {
    if (
      !ledger.attempts.some(
        (attempt) =>
          attempt.phase === phase &&
          attempt.role === 'baseline' &&
          attempt.status === 'completed' &&
          attempt.datasetSha256 === datasetSha256,
      )
    ) {
      throw new Error('Falta baseline completa de la misma fase y dataset.');
    }

    if (
      (!hashes.has(prompt.sha256) && hashes.size >= 5) ||
      candidateAttempts.some(
        (attempt) =>
          (attempt.promptId === prompt.id && attempt.promptSha256 !== prompt.sha256) ||
          (attempt.promptId !== prompt.id && attempt.promptSha256 === prompt.sha256),
      ) ||
      (phase === 'validation' &&
        (!candidateAttempts.some(
          (attempt) =>
            attempt.phase === 'development' &&
            attempt.promptSha256 === prompt.sha256 &&
            attempt.status === 'completed',
        ) ||
          candidateAttempts.some((attempt) => attempt.phase === 'validation')))
    ) {
      throw new Error(
        'Candidato duplicado, modificado, no elegible para validación o límite excedido.',
      );
    }
  }

  const attempt: BudgetAttempt = {
    id: randomUUID(),
    promptId: prompt.id,
    promptVersion: prompt.version,
    promptSha256: prompt.sha256,
    role: prompt.role,
    phase,
    datasetSha256,
    protocolSha256,
    plannedInferences: 60,
    status: 'reserved',
    reportRunId: null,
  };
  ledger.attempts.push(attempt);

  return attempt;
}

export async function withExperimentLedger<T>(
  directory: string,
  operation: (ledger: ExperimentLedger, save: () => Promise<void>) => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, 'i003-budget.lock');
  const lock = await open(lockPath, 'wx');
  const filePath = join(directory, 'i003-budget.json');

  try {
    let ledger: ExperimentLedger = { schemaVersion: 1, attempts: [] };

    try {
      ledger = JSON.parse(await readFile(filePath, 'utf8')) as ExperimentLedger;
      validateLedger(ledger);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }

    const save = async () => {
      validateLedger(ledger);
      const temporary = join(directory, `i003-budget-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
      await rename(temporary, filePath);
    };

    return await operation(ledger, save);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
