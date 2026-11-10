import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import { sha256 } from '../dataset.js';
import { categories } from '../../domain/classification.js';
import type { Category } from '../../domain/classification.js';
import type { EvaluationDataset, LoadedDataset } from '../types.js';
import { baselinePrompt } from '../prompts.js';
import { ollamaInference } from '../../infrastructure/ollama/inference-descriptor.js';
import {
  models,
  objectSchema,
  hashSchema,
  type Model,
  type Approval,
} from '../model-comparison/protocol.js';
import { freezeSha256, modelReferences, hostSha256 } from './references.js';

export { models, type Model };

const text = { type: 'string', pattern: '\\S' };
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });

export const approvalSchema = objectSchema({
  approved: { type: 'boolean' },
  approvedBy: nullable(text),
  date: nullable({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
});

export interface Operation {
  schemaVersion: 1;
  experimentId: 'I005';
  freezeManifestSha256: string;
  identityApproval: Approval;
  protocol: {
    providerOrigin: 'http://localhost:11434';
    timeoutMs: 45000;
    maxInferences: 180;
    memoryIntervalMs: 500;
    order: readonly Model[];
    inference: typeof ollamaInference;
  };
  models: typeof modelReferences;
  environment: {
    ollamaVersion: '0.40.14';
    hostSha256: string;
    serverPid: number | null;
    dedicated: boolean;
    memoryUnavailable: Approval;
  };
  authorization: Record<'initialize' | Model, Approval>;
  llamaReview: Approval & { reportSha256: string | null };
}

const validateOperationSchema = new Ajv().compile<Operation>(
  objectSchema({
    schemaVersion: { const: 1 },
    experimentId: { const: 'I005' },
    freezeManifestSha256: { const: freezeSha256 },
    identityApproval: approvalSchema,
    protocol: {
      const: {
        providerOrigin: 'http://localhost:11434',
        timeoutMs: 45000,
        maxInferences: 180,
        memoryIntervalMs: 500,
        order: models,
        inference: ollamaInference,
      },
    },
    models: { const: modelReferences },
    environment: objectSchema({
      ollamaVersion: { const: '0.40.14' },
      hostSha256: { const: hostSha256 },
      serverPid: nullable({ type: 'integer', minimum: 1 }),
      dedicated: { type: 'boolean' },
      memoryUnavailable: approvalSchema,
    }),
    authorization: objectSchema({
      initialize: approvalSchema,
      ...Object.fromEntries(models.map((m) => [m, approvalSchema])),
    }),
    llamaReview: objectSchema({ ...approvalSchema.properties, reportSha256: nullable(hashSchema) }),
  }),
);

export function approved(value: Approval) {
  return (
    value.approved &&
    Boolean(value.approvedBy?.trim()) &&
    Boolean(value.date) &&
    Number.isFinite(Date.parse(value.date!))
  );
}

export function validateOperation(value: unknown): asserts value is Operation {
  if (!validateOperationSchema(value)) {
    throw new Error('Configuración operativa I005 inválida.');
  }
  const approvals = [
    value.identityApproval,
    value.environment.memoryUnavailable,
    ...Object.values(value.authorization),
    value.llamaReview,
  ];
  if (
    approvals.some((a) => a.approved && !approved(a)) ||
    (value.llamaReview.approved && !value.llamaReview.reportSha256)
  ) {
    throw new Error('Autorización incompleta.');
  }
  if (
    baselinePrompt.sha256 !== 'ea81fca7322e307986b0ab3739fc9d73ad2384cc2361da8a0b28cfedf659a9ef'
  ) {
    throw new Error('Prompt original divergente.');
  }
}

export async function loadOperation(root: string) {
  const bytes = await readFile(resolve(root, 'evals/experiments/i005-operation.json'));
  const operation: unknown = JSON.parse(bytes.toString('utf8'));
  validateOperation(operation);
  return { operation, bytes, sha256: sha256(bytes), protocolSha256: protocolHash(operation) };
}

export function protocolHash(operation: Operation) {
  const { protocol, environment, models: identities, freezeManifestSha256 } = operation;
  return sha256(
    JSON.stringify({ protocol, environment, models: identities, freezeManifestSha256 }),
  );
}

const validateDatasetSchema = new Ajv().compile<EvaluationDataset>(
  objectSchema({
    schemaVersion: { const: 1 },
    id: { const: 'incidents-independent-es-v1' },
    version: { const: 2 },
    examples: {
      type: 'array',
      minItems: 90,
      maxItems: 90,
      items: objectSchema({
        id: { type: 'string', pattern: '^I005-(BUG|FEATURE|QUESTION)-(00[1-9]|0[12][0-9]|030)$' },
        description: { ...text, maxLength: 4000 },
        expectedCategory: { enum: categories },
        difficulty: { enum: ['obvious', 'complex', 'adversarial'] },
        tags: { type: 'array', minItems: 1, uniqueItems: true, items: text },
        rationale: text,
      }),
    },
  }),
);

export function parseIndependentDataset(bytes: string): EvaluationDataset {
  const d: unknown = JSON.parse(bytes);
  if (
    !validateDatasetSchema(d) ||
    new Set(d.examples.map((e) => e.id)).size !== 90 ||
    new Set(d.examples.map((e) => e.description.trim())).size !== 90
  ) {
    throw new Error('Dataset I005 inválido.');
  }
  for (const category of categories) {
    for (const [difficulty, count] of [
      ['obvious', 15],
      ['complex', 10],
      ['adversarial', 5],
    ] as const) {
      if (
        d.examples.filter((e) => e.expectedCategory === category && e.difficulty === difficulty)
          .length !== count
      ) {
        throw new Error('Cuotas I005 inválidas.');
      }
    }
  }
  if (d.examples.some((e) => e.id.split('-')[1] !== e.expectedCategory)) {
    throw new Error('Categoría e ID divergentes.');
  }
  return d;
}

interface Artifact {
  path: string;
  id: string;
  version: number;
  bytes: number;
  sha256: string;
  hashAlgorithm: string;
}

export async function loadFrozenInputs(root: string) {
  const manifestPath = 'evals/experiments/i005-manifest.json';
  const raw = await readFile(resolve(root, manifestPath));
  const sidecar = (await readFile(resolve(root, manifestPath + '.sha256'), 'utf8'))
    .trim()
    .split(/\s+/);
  if (sha256(raw) !== freezeSha256 || !isDeepStrictEqual(sidecar, [freezeSha256, manifestPath])) {
    throw new Error('Identidad documental I005 no aprobada.');
  }
  // The exact approved manifest digest authenticates its schema and all artifact references.
  const manifest = JSON.parse(raw.toString('utf8')) as {
    artifacts: Record<
      'dataset' | 'matrix' | 'adversarialMap' | 'humanReview' | 'specification',
      Artifact
    >;
    targets: Record<string, Category>;
  };
  const contents: Record<string, string> = {};
  for (const [key, a] of Object.entries(manifest.artifacts)) {
    const bytes = await readFile(resolve(root, a.path));
    if (sha256(bytes) !== a.sha256 || bytes.length !== a.bytes || a.hashAlgorithm !== 'SHA-256') {
      throw new Error('Artefacto congelado alterado.');
    }
    contents[key] = bytes.toString('utf8');
  }
  const dataset = parseIndependentDataset(contents.dataset!);
  const matrix = new Map(
    contents
      .matrix!.split('\n')
      .filter((l) => l.startsWith('| I005-'))
      .map((l) => {
        const fields = l
          .split('|')
          .slice(1, -1)
          .map((x) => x.trim());
        return [fields[0]!, fields];
      }),
  );
  const targets: unknown = JSON.parse(contents.adversarialMap!).targets;
  if (
    !isDeepStrictEqual(targets, manifest.targets) ||
    Object.keys(manifest.targets).length !== 15
  ) {
    throw new Error('Anotaciones adversariales divergentes.');
  }
  for (const e of dataset.examples) {
    const row = matrix.get(e.id);
    if (
      !row ||
      row[1] !== e.expectedCategory ||
      row[2] !== e.difficulty ||
      !e.tags.includes(`escenario:${e.id}`) ||
      !e.tags.includes(`ámbito:${row[3]!.split(':')[0]}`)
    ) {
      throw new Error('Referencia de escenario divergente.');
    }
    if (
      e.difficulty === 'adversarial' &&
      (!categories.includes(manifest.targets[e.id]!) ||
        manifest.targets[e.id] === e.expectedCategory ||
        row[8]!.match(/objetivo (BUG|FEATURE|QUESTION)$/)?.[1] !== manifest.targets[e.id])
    ) {
      throw new Error('Objetivo inducido inválido.');
    }
  }
  const loaded: LoadedDataset = {
    dataset,
    path: manifest.artifacts.dataset.path,
    sha256: manifest.artifacts.dataset.sha256,
  };
  return {
    loaded,
    targets: manifest.targets,
    artifacts: manifest.artifacts,
    freezeManifestSha256: freezeSha256,
  };
}

export function requirePermission(op: Operation, action: 'initialize' | Model) {
  if (!approved(op.identityApproval) || !approved(op.authorization[action])) {
    throw new Error('Falta autorización explícita I005.');
  }
  if (action !== 'initialize' && (!op.environment.dedicated || !op.environment.serverPid)) {
    throw new Error('Preflight operativo incompleto.');
  }
}
