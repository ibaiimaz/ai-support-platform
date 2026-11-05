import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { categories } from '../domain/classification.js';
import { difficulties, type EvaluationDataset, type LoadedDataset } from './types.js';

const nonBlank = { type: 'string', pattern: '\\S' };
const validate = new Ajv().compile<EvaluationDataset>({
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'version', 'examples'],
  properties: {
    schemaVersion: { const: 1 },
    id: nonBlank,
    version: { type: 'integer', minimum: 1 },
    examples: {
      type: 'array',
      minItems: 60,
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'description', 'expectedCategory', 'difficulty', 'tags', 'rationale'],
        properties: {
          id: nonBlank,
          description: { ...nonBlank, maxLength: 4000 },
          expectedCategory: { enum: [...categories] },
          difficulty: { enum: [...difficulties] },
          tags: { type: 'array', minItems: 1, uniqueItems: true, items: nonBlank },
          rationale: nonBlank,
        },
      },
    },
  },
});

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function parseDataset(content: string): EvaluationDataset {
  let dataset: unknown;

  try {
    dataset = JSON.parse(content);
  } catch {
    throw new Error('Dataset JSON inválido.');
  }

  if (!validate(dataset)) {
    throw new Error('Contrato del dataset inválido.');
  }

  const ids = new Set(dataset.examples.map((example) => example.id));
  const descriptions = new Set(dataset.examples.map((example) => example.description.trim()));

  if (ids.size !== 60 || descriptions.size !== 60) {
    throw new Error('Dataset con identificadores o descripciones duplicados.');
  }

  for (const category of categories) {
    const examples = dataset.examples.filter((example) => example.expectedCategory === category);

    for (const [difficulty, expected] of [
      ['obvious', 10],
      ['complex', 7],
      ['adversarial', 3],
    ] as const) {
      if (examples.filter((example) => example.difficulty === difficulty).length !== expected) {
        throw new Error('Distribución del dataset inválida.');
      }
    }
  }

  return dataset;
}

export async function loadDataset(filePath: string, reportPath: string): Promise<LoadedDataset> {
  const bytes = await readFile(filePath);

  return { dataset: parseDataset(bytes.toString('utf8')), sha256: sha256(bytes), path: reportPath };
}
