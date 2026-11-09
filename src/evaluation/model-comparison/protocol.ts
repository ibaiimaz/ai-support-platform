import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import { sha256, loadDataset } from '../dataset.js';
import { categories, type Category } from '../../domain/classification.js';
import { baselinePrompt } from '../prompts.js';
import { ollamaInference } from '../../infrastructure/ollama/inference-descriptor.js';
import type { EvaluationExample } from '../types.js';

export const models = ['llama3.1:8b', 'gemma3:12b'] as const;

export const phases = ['compatibility', 'benchmark'] as const;

export type Model = (typeof models)[number];

export type Phase = (typeof phases)[number];

export interface Approval {
  approved: boolean;
  approvedBy: string | null;
  date: string | null;
}

export interface ModelIdentity {
  digest: string | null;
  templateSha256: string | null;
  parametersSha256: string | null;
  parameters: string | null;
  quantization: string | null;
  modelContextLength: number | null;
  storedBytes: number | null;
}

export interface Manifest {
  schemaVersion: 1;
  experimentId: 'I004';
  protocol: {
    providerOrigin: string;
    timeoutMs: 45000;
    maxInferences: 126;
    memoryIntervalMs: 500;
    order: typeof models;
    inference: typeof ollamaInference;
  };
  promptSha256: string;
  benchmark: { path: string; id: string; version: 2; sha256: string };
  compatibility: { path: string; id: string; version: 1; sha256: string; review: Approval };
  targets: Record<string, Category>;
  models: Record<Model, ModelIdentity>;
  environment: {
    ollamaVersion: string | null;
    hostSha256: string | null;
    serverPid: number | null;
    dedicated: boolean;
    memoryUnavailable: Approval;
  };
  authorization: Record<Phase, Record<Model, Approval>>;
}

export const objectSchema = (properties: Record<string, unknown>) => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
  additionalProperties: false,
});

export const hashSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = { type: 'string', pattern: '\\S' };
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const approvalSchema = objectSchema({
  approved: { type: 'boolean' },
  approvedBy: nullable(text),
  date: nullable({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
});

export const identitySchema = objectSchema({
  digest: nullable(hashSchema),
  templateSha256: nullable(hashSchema),
  parametersSha256: nullable(hashSchema),
  parameters: nullable({ type: 'string' }),
  quantization: nullable(text),
  modelContextLength: nullable({ type: 'integer', minimum: 1 }),
  storedBytes: nullable({ type: 'integer', minimum: 1 }),
});
const modelRecord = (schema: unknown) =>
  objectSchema(Object.fromEntries(models.map((m) => [m, schema])));
const validate = new Ajv().compile<Manifest>(
  objectSchema({
    schemaVersion: { const: 1 },
    experimentId: { const: 'I004' },
    protocol: objectSchema({
      providerOrigin: text,
      timeoutMs: { const: 45000 },
      maxInferences: { const: 126 },
      memoryIntervalMs: { const: 500 },
      order: { const: models },
      inference: { const: ollamaInference },
    }),
    promptSha256: { const: 'ea81fca7322e307986b0ab3739fc9d73ad2384cc2361da8a0b28cfedf659a9ef' },
    benchmark: objectSchema({
      path: { const: 'evals/datasets/incidents-v1.json' },
      id: { const: 'incidents-es-v1' },
      version: { const: 2 },
      sha256: { const: 'e17fcb2ea94126809319133a9ba78fa1108e7efe21ed62f45c88167bebe72c90' },
    }),
    compatibility: objectSchema({
      path: { const: 'evals/experiments/i004-compatibility-cases.json' },
      id: { const: 'i004-compatibility-es-v1' },
      version: { const: 1 },
      sha256: hashSchema,
      review: approvalSchema,
    }),
    targets: {
      type: 'object',
      minProperties: 9,
      maxProperties: 9,
      additionalProperties: { enum: categories },
    },
    models: modelRecord(identitySchema),
    environment: objectSchema({
      ollamaVersion: nullable(text),
      hostSha256: nullable(hashSchema),
      serverPid: nullable({ type: 'integer', minimum: 1 }),
      dedicated: { type: 'boolean' },
      memoryUnavailable: approvalSchema,
    }),
    authorization: objectSchema(
      Object.fromEntries(phases.map((p) => [p, modelRecord(approvalSchema)])),
    ),
  }),
);

export function approved(value: Approval): boolean {
  return value.approved && Boolean(value.approvedBy?.trim() && value.date);
}

export function validateManifest(value: unknown): asserts value is Manifest {
  if (!validate(value)) {
    throw new Error('Manifiesto I004 inválido.');
  }
  const origin = new URL(value.protocol.providerOrigin);
  if (
    origin.origin !== value.protocol.providerOrigin ||
    origin.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  ) {
    throw new Error('I004 requiere un servicio HTTP local explícito.');
  }
  if (
    models.some(
      (m) =>
        value.models[m].parameters !== null &&
        value.models[m].parametersSha256 !== sha256(value.models[m].parameters!),
    )
  ) {
    throw new Error('Parámetros heredados y hash divergentes.');
  }
  const approvals = [
    value.compatibility.review,
    value.environment.memoryUnavailable,
    ...phases.flatMap((p) => models.map((m) => value.authorization[p][m])),
  ];
  if (approvals.some((a) => a.approved && !approved(a))) {
    throw new Error('Aprobación sin responsable o fecha.');
  }
  if (value.promptSha256 !== baselinePrompt.sha256) {
    throw new Error('Prompt original divergente.');
  }
}

export function requireAuthorization(manifest: Manifest, phase: Phase, model: Model) {
  if (
    !approved(manifest.authorization[phase][model]) ||
    !approved(manifest.compatibility.review) ||
    !manifest.environment.dedicated ||
    !manifest.environment.serverPid ||
    !manifest.environment.hostSha256 ||
    !manifest.environment.ollamaVersion ||
    models.some((m) => Object.values(manifest.models[m]).some((v) => v === null))
  ) {
    throw new Error('Faltan autorización, revisión o metadatos congelados.');
  }
}

export async function loadManifest(root: string) {
  const bytes = await readFile(resolve(root, 'evals/experiments/i004-manifest.json'));
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  validateManifest(value);
  const { authorization: _authorization, ...frozen } = value;
  return {
    manifest: value,
    bytes,
    sha256: sha256(bytes),
    protocolSha256: sha256(JSON.stringify(frozen)),
  };
}

const validateCompatibility = new Ajv().compile<{
  schemaVersion: 1;
  id: string;
  version: 1;
  examples: EvaluationExample[];
}>(
  objectSchema({
    schemaVersion: { const: 1 },
    id: { const: 'i004-compatibility-es-v1' },
    version: { const: 1 },
    examples: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: objectSchema({
        id: { type: 'string', pattern: '^I004-COMP-[A-Z]+$' },
        description: { ...text, maxLength: 4000 },
        expectedCategory: { enum: categories },
        difficulty: { const: 'obvious' },
        tags: { type: 'array', minItems: 1, uniqueItems: true, items: text },
        rationale: text,
      }),
    },
  }),
);

export async function loadInputs(root: string, manifest: Manifest) {
  const benchmark = await loadDataset(
    resolve(root, manifest.benchmark.path),
    manifest.benchmark.path,
  );
  if (
    benchmark.sha256 !== manifest.benchmark.sha256 ||
    benchmark.dataset.id !== manifest.benchmark.id ||
    benchmark.dataset.version !== manifest.benchmark.version
  ) {
    throw new Error('Benchmark congelado divergente.');
  }
  const i003 = JSON.parse(
    await readFile(resolve(root, 'evals/experiments/i003-manifest.json'), 'utf8'),
  );
  if (!isDeepStrictEqual(manifest.targets, i003.datasets.development.targets)) {
    throw new Error('Anotaciones inducidas divergentes.');
  }
  const bytes = await readFile(resolve(root, manifest.compatibility.path));
  const compatibility: unknown = JSON.parse(bytes.toString('utf8'));
  if (sha256(bytes) !== manifest.compatibility.sha256 || !validateCompatibility(compatibility)) {
    throw new Error('Casos de compatibilidad divergentes.');
  }
  const examples = compatibility.examples;
  if (
    new Set(examples.map((e) => e.id)).size !== 3 ||
    new Set(examples.map((e) => e.description.trim())).size !== 3 ||
    categories.some((c) => examples.filter((e) => e.expectedCategory === c).length !== 1) ||
    examples.some((e) =>
      benchmark.dataset.examples.some(
        (b) => b.id === e.id || b.description.trim() === e.description.trim(),
      ),
    )
  ) {
    throw new Error('Compatibilidad no independiente o desequilibrada.');
  }
  return { benchmark, compatibility };
}
