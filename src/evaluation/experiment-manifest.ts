import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import { ollamaInference } from '../infrastructure/ollama/inference-descriptor.js';
import type { Category } from '../domain/classification.js';
import { categories } from '../domain/classification.js';
import { decisionThresholds } from './decisions.js';
import { registeredPrompts } from './prompts.js';
import { sha256 } from './dataset.js';

export type Phase = 'development' | 'validation';

export interface ExperimentManifest {
  schemaVersion: 1;
  experimentId: 'I003';
  protocol: {
    model: string;
    timeoutMs: number;
    providerOrigin: string;
    inference: typeof ollamaInference;
    thresholds: typeof decisionThresholds;
    maxCandidates: 5;
    maxInferences: 480;
  };
  datasets: Record<
    Phase,
    {
      path: string;
      id: string;
      version: number;
      sha256: string;
      reviewStatus: 'pending' | 'approved';
      frozen: boolean;
      approvedBy: string | null;
      targets: Record<string, Category>;
    }
  >;
  prompts: {
    id: string;
    version: number;
    sha256: string;
    hypothesis: string;
    risks: readonly string[];
    module: string;
    byteLength: number;
  }[];
  authorization: {
    development: boolean;
    validation: boolean | 'baseline-only';
  };
  selection: { promptId: string | null; approvedBy: string | null };
  preparation: {
    date: string;
    sequence: string;
    isolation: 'procedural';
    validationApproved: boolean;
  };
}

const strictObject = (properties: Record<string, unknown>) => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
  additionalProperties: false,
});
const text = { type: 'string', minLength: 1 };
const nullableText = { anyOf: [text, { type: 'null' }] };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const datasetSchema = strictObject({
  path: { type: 'string', pattern: '^evals/datasets/[a-z0-9-]+\\.json$' },
  id: text,
  version: { type: 'integer', minimum: 1 },
  sha256: hash,
  reviewStatus: { enum: ['pending', 'approved'] },
  frozen: { type: 'boolean' },
  approvedBy: nullableText,
  targets: {
    type: 'object',
    minProperties: 9,
    maxProperties: 9,
    additionalProperties: { enum: [...categories] },
  },
});
const validate = new Ajv().compile<ExperimentManifest>(
  strictObject({
    schemaVersion: { const: 1 },
    experimentId: { const: 'I003' },
    protocol: strictObject({
      model: { const: 'llama3.1:8b' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647 },
      providerOrigin: text,
      inference: { const: ollamaInference },
      thresholds: { const: decisionThresholds },
      maxCandidates: { const: 5 },
      maxInferences: { const: 480 },
    }),
    datasets: strictObject({ development: datasetSchema, validation: datasetSchema }),
    prompts: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: strictObject({
        id: text,
        version: { type: 'integer', minimum: 1 },
        sha256: hash,
        hypothesis: text,
        risks: { type: 'array', minItems: 1, items: text },
        module: text,
        byteLength: { type: 'integer', minimum: 1 },
      }),
    },
    authorization: strictObject({
      development: { type: 'boolean' },
      validation: { enum: [false, true, 'baseline-only'] },
    }),
    selection: strictObject({ promptId: nullableText, approvedBy: nullableText }),
    preparation: strictObject({
      date: text,
      sequence: text,
      isolation: { const: 'procedural' },
      validationApproved: { type: 'boolean' },
    }),
  }),
);

export function validateManifest(value: unknown): asserts value is ExperimentManifest {
  if (!validate(value)) {
    throw new Error('Manifiesto experimental inválido.');
  }

  if (
    value.preparation.validationApproved !==
    (value.datasets.validation.reviewStatus === 'approved')
  ) {
    throw new Error('Estado de revisión de validación inconsistente.');
  }

  const ids = new Set<string>();
  const hashes = new Set<string>();

  for (const item of value.prompts) {
    const prompt = registeredPrompts.find(
      (entry) => entry.id === item.id && entry.role === 'candidate',
    );
    const { text: _text, role: _role, ...metadata } = prompt ?? {};

    if (
      !prompt ||
      !isDeepStrictEqual(metadata, item) ||
      ids.has(item.id) ||
      hashes.has(item.sha256)
    ) {
      throw new Error('Registro de prompts divergente o duplicado.');
    }

    ids.add(item.id);
    hashes.add(item.sha256);
  }

  if (
    value.selection.promptId !== null &&
    (!ids.has(value.selection.promptId) || !value.selection.approvedBy?.trim())
  ) {
    throw new Error('Selección sin aprobación o no registrada.');
  }

  for (const dataset of Object.values(value.datasets)) {
    if (
      (dataset.reviewStatus === 'approved' || dataset.frozen) &&
      (dataset.reviewStatus !== 'approved' || !dataset.frozen || !dataset.approvedBy?.trim())
    ) {
      throw new Error('Aprobación o congelación de dataset inconsistente.');
    }
  }
}

export async function loadManifest(root: string, phase: Phase = 'development') {
  const bytes = await readFile(resolve(root, 'evals/experiments/i003-manifest.json'));
  const manifest: unknown = JSON.parse(bytes.toString('utf8'));
  validateManifest(manifest);

  return {
    manifest,
    sha256: sha256(bytes),
    protocolSha256: sha256(
      JSON.stringify({
        protocol: manifest.protocol,
        phase,
        dataset: {
          id: manifest.datasets[phase].id,
          version: manifest.datasets[phase].version,
          sha256: manifest.datasets[phase].sha256,
          targets: manifest.datasets[phase].targets,
        },
      }),
    ),
  };
}
