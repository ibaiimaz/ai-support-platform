import { readFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import { categories } from '../../domain/classification.js';
import { readIncidentId } from '../../application/get-incident-by-id.js';
import { sha256 } from '../dataset.js';
import { groups, type EvaluationDataset } from './types.js';

const text = { type: 'string', pattern: '\\S' };
const incidentId = { type: 'string', pattern: '^INC-[1-9][0-9]{0,5}$' };
const nullableText = { anyOf: [text, { type: 'null' }] };
const strings = { type: 'array', uniqueItems: true, items: text };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const expectedFinal = {
  oneOf: [
    object({ status: { const: 'CLASSIFIED' }, category: { enum: categories } }),
    object({ status: { const: 'INSUFFICIENT_CONTEXT' }, category: { type: 'null' } }),
  ],
};
const validate = new Ajv().compile<EvaluationDataset>(
  object({
    schemaVersion: { const: 1 },
    id: { enum: ['incidents-tool-calling-es-v1', 'incidents-tool-calling-holdout-es-v1'] },
    version: { type: 'integer', minimum: 1 },
    reviewStatus: { const: 'CANDIDATE' },
    examples: {
      type: 'array',
      minItems: 60,
      maxItems: 60,
      items: object({
        id: { type: 'string', pattern: '^I006-(?:H-)?[0-9]{3}$' },
        group: { enum: groups },
        description: { ...text, maxLength: 4000 },
        toolExpected: { type: 'boolean' },
        expectedTool: {
          anyOf: [object({ name: { const: 'getIncidentById' }, incidentId }), { type: 'null' }],
        },
        expectedFinal,
        fixture: object({
          incidents: {
            type: 'array',
            items: object({
              id: incidentId,
              title: text,
              description: text,
              category: { enum: categories },
            }),
          },
          unavailableIds: { type: 'array', uniqueItems: true, items: incidentId },
        }),
        scenario: text,
        tags: { ...strings, minItems: 1 },
        rationale: text,
        counterfactualPairId: nullableText,
        adversarial: {
          anyOf: [
            object({
              vector: text,
              expectedBehavior: text,
              forbiddenIncidentIds: { type: 'array', uniqueItems: true, items: incidentId },
              failureConditions: { ...strings, minItems: 1 },
            }),
            { type: 'null' },
          ],
        },
      }),
    },
    counterfactualPairs: {
      type: 'array',
      minItems: 10,
      maxItems: 10,
      items: object({
        id: text,
        caseIds: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: text },
        changedCondition: text,
        expectedBehavior: text,
        rationale: text,
      }),
    },
  }),
);

export function parseDataset(bytes: string): EvaluationDataset {
  const dataset: unknown = JSON.parse(bytes);
  if (!validate(dataset)) {
    throw new Error('Invalid I006 dataset schema');
  }
  const ids = new Set(dataset.examples.map((example) => example.id));
  if (ids.size !== 60) {
    throw new Error('Duplicate I006 case');
  }
  const quotas = [10, 10, 20, 10, 10];
  for (const [index, group] of groups.entries()) {
    if (dataset.examples.filter((example) => example.group === group).length !== quotas[index]) {
      throw new Error('Invalid I006 group quota');
    }
  }
  let notFound = 0;
  let unavailable = 0;
  for (const example of dataset.examples) {
    const pattern =
      dataset.id === 'incidents-tool-calling-es-v1' ? /^I006-[0-9]{3}$/ : /^I006-H-[0-9]{3}$/;
    if (pattern.exec(example.id)?.[0] !== example.id) {
      throw new Error('Invalid complete case ID');
    }
    if (
      example.expectedTool &&
      readIncidentId({
        name: example.expectedTool.name,
        arguments: { incidentId: example.expectedTool.incidentId },
      }) !== example.expectedTool.incidentId
    ) {
      throw new Error('Expected tool ID must be canonical');
    }
    if (example.toolExpected !== (example.expectedTool !== null)) {
      throw new Error('Inconsistent tool expectation');
    }
    const stored = example.fixture.incidents.map((incident) => incident.id);
    const unavailableIds = example.fixture.unavailableIds;
    if (
      new Set(stored).size !== stored.length ||
      stored.some((id) => unavailableIds.includes(id)) ||
      [...stored, ...unavailableIds].some(
        (id) => !/^INC-[1-9][0-9]{0,5}$/.test(id) || id.includes('\n'),
      )
    ) {
      throw new Error('Inconsistent fixture');
    }
    if (
      example.group.startsWith('direct_') &&
      (example.toolExpected || example.expectedFinal.status !== 'CLASSIFIED')
    ) {
      throw new Error('Invalid direct case');
    }
    if (
      example.group === 'lookup_required' &&
      (!example.expectedTool || !stored.includes(example.expectedTool.incidentId))
    ) {
      throw new Error('Necessary lookup must have context');
    }
    if (example.group === 'lookup_unavailable') {
      const id = example.expectedTool?.incidentId;
      if (!id || stored.includes(id)) {
        throw new Error('Unavailable case requires lookup without FOUND');
      }
      if (unavailableIds.includes(id)) {
        unavailable++;
      } else {
        notFound++;
      }
    }
    if (
      (example.adversarial !== null) !== example.tags.includes('adversarial') ||
      (example.adversarial !== null && example.group !== 'adversarial_or_ambiguous')
    ) {
      throw new Error('Invalid adversarial annotation');
    }
  }
  const special = dataset.examples.filter(
    (example) => example.group === 'adversarial_or_ambiguous',
  );
  if (
    notFound !== 5 ||
    unavailable !== 5 ||
    special.filter((example) => example.adversarial !== null).length !== 6 ||
    special.filter((example) => example.tags.includes('ambiguous') && example.adversarial === null)
      .length !== 4
  ) {
    throw new Error('Invalid I006 subgroup quotas');
  }
  const pairIds = new Set<string>();
  const pairedCases = new Set<string>();
  for (const pair of dataset.counterfactualPairs) {
    if (pairIds.has(pair.id)) {
      throw new Error('Duplicate pair');
    }
    pairIds.add(pair.id);
    for (const id of pair.caseIds) {
      const example = dataset.examples.find((item) => item.id === id);
      if (!example || pairedCases.has(id) || example.counterfactualPairId !== pair.id) {
        throw new Error('Invalid pair reference');
      }
      pairedCases.add(id);
    }
  }
  if (
    dataset.examples.some(
      (example) => (example.counterfactualPairId !== null) !== pairedCases.has(example.id),
    )
  ) {
    throw new Error('Unlinked pair annotation');
  }
  return dataset;
}

export async function loadDataset(path: string) {
  const bytes = await readFile(path);
  return { dataset: parseDataset(bytes.toString('utf8')), hash: sha256(bytes) };
}
