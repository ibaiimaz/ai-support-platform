import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { categories, type Category } from '../../src/domain/classification.js';
import type { EvaluationDataset, EvaluationResult } from '../../src/evaluation/types.js';

export function fixtureDataset(): EvaluationDataset {
  return {
    schemaVersion: 1,
    id: 'fixture-es',
    version: 1,
    examples: categories.flatMap((category) =>
      Array.from({ length: 20 }, (_, index) => ({
        id: `${category}-${index}`,
        description: `  DESCRIPTION_SECRET ${category} ${index}  `,
        expectedCategory: category,
        difficulty:
          index < 10
            ? ('obvious' as const)
            : index < 17
              ? ('complex' as const)
              : ('adversarial' as const),
        tags: ['fixture'],
        rationale: 'REFERENCE_SECRET',
      })),
    ),
  };
}

export function result(
  expectedCategory: Category,
  predictedCategory: Category | null,
  id: string,
): EvaluationResult {
  const reference = {
    id,
    expectedCategory,
    difficulty: 'obvious' as const,
    tags: ['fixture'],
    durationMs: 1,
  };

  if (predictedCategory === null) {
    return { ...reference, status: 'error', errorKind: 'timeout' };
  }

  return {
    ...reference,
    status: expectedCategory === predictedCategory ? 'correct' : 'incorrect',
    predictedCategory,
  };
}

export async function temporaryProject(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'classification-evals-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'evals/datasets'), { recursive: true });
  await writeFile(join(root, 'evals/datasets/incidents-v1.json'), JSON.stringify(fixtureDataset()));

  return root;
}
