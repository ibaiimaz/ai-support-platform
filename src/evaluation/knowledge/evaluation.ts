import { Ajv } from 'ajv';
import type { KnowledgeAnswer, GenerationIdentity } from '../../knowledge/domain.js';
import { KnowledgeError } from '../../knowledge/domain.js';
import type { AskDependencies } from '../../knowledge/use-cases.js';
import { askKnowledgeQuestion } from '../../knowledge/use-cases.js';

export interface RagEvalCase {
  id: string;
  group: 'direct' | 'combined' | 'absent' | 'ambiguous' | 'injection';
  question: string;
  expectedStatus: 'ANSWER' | 'INSUFFICIENT_CONTEXT';
  relevantDocumentIds: string[];
  expectedFacts: string[];
  forbiddenClaims?: string[];
  hostilePayloads?: { id: string; documentId: string; text: string }[];
}

export interface RagDataset {
  schemaVersion: 1;
  contentVersion: number;
  datasetId: string;
  status: 'CANDIDATE';
  cases: RagEvalCase[];
}

const strings = { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } };
const validate = new Ajv().compile<RagDataset>({
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'contentVersion', 'datasetId', 'status', 'cases'],
  properties: {
    schemaVersion: { const: 1 },
    contentVersion: { type: 'integer', minimum: 1 },
    datasetId: { type: 'string', minLength: 1 },
    status: { const: 'CANDIDATE' },
    cases: {
      type: 'array',
      minItems: 20,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'group',
          'question',
          'expectedStatus',
          'relevantDocumentIds',
          'expectedFacts',
        ],
        properties: {
          id: { type: 'string', pattern: '^I007-[0-9]{3}$' },
          group: { enum: ['direct', 'combined', 'absent', 'ambiguous', 'injection'] },
          question: { type: 'string', pattern: '\\S', maxLength: 2000 },
          expectedStatus: { enum: ['ANSWER', 'INSUFFICIENT_CONTEXT'] },
          relevantDocumentIds: strings,
          expectedFacts: strings,
          forbiddenClaims: strings,
          hostilePayloads: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'documentId', 'text'],
              properties: {
                id: { type: 'string', pattern: '^I007-PAYLOAD-[0-9]+$' },
                documentId: { type: 'string', minLength: 1 },
                text: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    },
  },
});

export function validateDataset(
  value: unknown,
  documentIds: string[],
): asserts value is RagDataset {
  if (!validate(value) || new Set(value.cases.map((item) => item.id)).size !== value.cases.length) {
    throw new Error('Invalid RAG dataset');
  }
  const quotas = { direct: 6, combined: 4, absent: 4, ambiguous: 3, injection: 3 };
  for (const [group, count] of Object.entries(quotas)) {
    if (value.cases.filter((item) => item.group === group).length !== count) {
      throw new Error('Invalid RAG quotas');
    }
  }
  for (const item of value.cases) {
    if (
      item.relevantDocumentIds.some((id) => !documentIds.includes(id)) ||
      (item.expectedStatus === 'ANSWER' &&
        (!item.expectedFacts.length || !item.relevantDocumentIds.length)) ||
      (item.group === 'injection' &&
        (!item.forbiddenClaims?.length || !item.hostilePayloads?.length)) ||
      (item.group !== 'injection' && item.hostilePayloads !== undefined) ||
      (item.hostilePayloads?.some(
        (payload) => !item.relevantDocumentIds.includes(payload.documentId),
      ) ??
        false)
    ) {
      throw new Error('Invalid RAG expectation');
    }
  }
  const payloadIds = value.cases.flatMap(
    (item) => item.hostilePayloads?.map((payload) => payload.id) ?? [],
  );
  if (new Set(payloadIds).size !== payloadIds.length) {
    throw new Error('Duplicate hostile payload identity');
  }
}

export interface EvalResult {
  id: string;
  status: 'VALID' | 'TECHNICAL_ERROR';
  latencyMs: number;
  retrievalLatencyMs: number | null;
  retrievedDocumentIds: string[];
  retrievedChunkIds: string[];
  expectedStatus: RagEvalCase['expectedStatus'];
  actualStatus?: KnowledgeAnswer['status'];
  sources?: KnowledgeAnswer['sources'];
  error?: string;
  generationIdentity?: {
    expected: GenerationIdentity;
    before?: GenerationIdentity;
    after?: GenerationIdentity;
    verified: boolean;
  };
  attackExposure?: {
    generationRequested: boolean;
    // null means the delivery could not be confirmed, not resistance to the attack.
    hostilePayloadSent: boolean | null;
    matchedPayloadIds: string[];
    matchingChunkIds: string[];
  };
  // Optional, private, synthetic corpus only. Never emitted to application logs.
  reviewContent?: { answer: KnowledgeAnswer; context: { chunkId: string; content: string }[] };
}

export async function evaluateCase(
  dependencies: AskDependencies,
  item: RagEvalCase,
  retainSyntheticContent = false,
): Promise<EvalResult> {
  const started = performance.now();
  const result: EvalResult = {
    id: item.id,
    status: 'TECHNICAL_ERROR',
    latencyMs: 0,
    retrievalLatencyMs: null,
    retrievedDocumentIds: [],
    retrievedChunkIds: [],
    expectedStatus: item.expectedStatus,
  };
  let context: { chunkId: string; content: string }[] = [];
  if (item.group === 'injection') {
    result.attackExposure = {
      generationRequested: false,
      hostilePayloadSent: false,
      matchedPayloadIds: [],
      matchingChunkIds: [],
    };
  }
  const observed: AskDependencies = {
    ...dependencies,
    generator: {
      async generate(question, chunks) {
        const exposure = result.attackExposure;
        if (exposure) {
          exposure.generationRequested = true;
          for (const payload of item.hostilePayloads ?? []) {
            const matching = chunks.filter(
              (chunk) =>
                chunk.documentId === payload.documentId && chunk.content.includes(payload.text),
            );
            if (matching.length) {
              exposure.matchedPayloadIds.push(payload.id);
              exposure.matchingChunkIds.push(...matching.map((chunk) => chunk.chunkId));
            }
          }
          exposure.matchingChunkIds = [...new Set(exposure.matchingChunkIds)];
          exposure.hostilePayloadSent = exposure.matchedPayloadIds.length ? null : false;
        }
        const answer = await dependencies.generator.generate(question, chunks);
        if (exposure && exposure.matchedPayloadIds.length) {
          // A completed generator response confirms the request boundary; retrieval alone does not.
          exposure.hostilePayloadSent = true;
        }
        return answer;
      },
    },
  };
  try {
    const answer = await askKnowledgeQuestion(observed, item.question, (chunks, latency) => {
      result.retrievalLatencyMs = latency;
      result.retrievedDocumentIds = [...new Set(chunks.map((chunk) => chunk.documentId))];
      result.retrievedChunkIds = chunks.map((chunk) => chunk.chunkId);
      context = chunks
        .slice(0, dependencies.maxContextChunks)
        .map(({ chunkId, content }) => ({ chunkId, content }));
    });
    result.status = 'VALID';
    result.actualStatus = answer.status;
    result.sources = answer.sources;
    if (retainSyntheticContent) {
      result.reviewContent = { answer, context };
    }
  } catch (error) {
    result.error = error instanceof KnowledgeError ? error.kind : 'UNEXPECTED_ERROR';
  }
  result.latencyMs = performance.now() - started;
  return result;
}

export const ratio = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  percentage: denominator ? (numerator / denominator) * 100 : null,
});

function attackExposureCoverage(dataset: RagDataset, results: EvalResult[]) {
  const attacks = results.filter((result) =>
    dataset.cases.some((sample) => sample.id === result.id && sample.group === 'injection'),
  );
  const planned = dataset.cases.filter((item) => item.group === 'injection').length;
  return {
    planned,
    processed: attacks.length,
    unprocessed: planned - attacks.length,
    valid: attacks.filter((result) => result.status === 'VALID').length,
    confirmedExposed: attacks.filter((result) => result.attackExposure?.hostilePayloadSent === true)
      .length,
    notExposed: attacks.filter((result) => result.attackExposure?.hostilePayloadSent === false)
      .length,
    exposureUnknown: attacks.filter(
      (result) =>
        result.attackExposure?.hostilePayloadSent === null ||
        result.attackExposure?.hostilePayloadSent === undefined,
    ).length,
  };
}

export function summarize(dataset: RagDataset, results: EvalResult[]) {
  const valid = results.filter((result) => result.status === 'VALID');
  const retrieval = results.filter(
    (result) =>
      result.retrievalLatencyMs !== null &&
      dataset.cases.find((item) => item.id === result.id)!.relevantDocumentIds.length,
  );
  const recalls = retrieval.map((result) => {
    const relevant = dataset.cases.find((item) => item.id === result.id)!.relevantDocumentIds;
    return (
      relevant.filter((id) => result.retrievedDocumentIds.includes(id)).length / relevant.length
    );
  });
  return {
    state:
      results.length === dataset.cases.length && valid.length === results.length
        ? 'COMPLETE_BASELINE'
        : 'INCOMPLETE',
    acceptance: 'NOT_ASSESSED',
    documentRecallAtK: {
      sumCaseRecall: recalls.reduce((sum, value) => sum + value, 0),
      cases: recalls.length,
      mean: recalls.length ? recalls.reduce((sum, value) => sum + value, 0) / recalls.length : null,
    },
    documentHitRateAtK: ratio(recalls.filter((value) => value > 0).length, recalls.length),
    statusAccuracy: ratio(
      valid.filter((result) => result.actualStatus === result.expectedStatus).length,
      valid.length,
    ),
    endToEndStatusSuccess: ratio(
      valid.filter((result) => result.actualStatus === result.expectedStatus).length,
      dataset.cases.length,
    ),
    correctAbstentions: valid.filter(
      (result) =>
        result.actualStatus === 'INSUFFICIENT_CONTEXT' &&
        result.expectedStatus === 'INSUFFICIENT_CONTEXT',
    ).length,
    incorrectAbstentions: valid.filter(
      (result) =>
        result.actualStatus === 'INSUFFICIENT_CONTEXT' && result.expectedStatus === 'ANSWER',
    ).length,
    answersWhenAbstentionExpected: valid.filter(
      (result) =>
        result.actualStatus === 'ANSWER' && result.expectedStatus === 'INSUFFICIENT_CONTEXT',
    ).length,
    technicalErrors: results.filter((result) => result.status === 'TECHNICAL_ERROR').length,
    unprocessed: dataset.cases.length - results.length,
    latencyMs: {
      total: results.reduce((sum, result) => sum + result.latencyMs, 0),
      mean: results.length
        ? results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length
        : null,
    },
    attackCoverage: attackExposureCoverage(dataset, results),
    semanticMetrics: 'PENDING_HUMAN_REVIEW',
    thresholds: null,
  };
}

export interface HumanReview {
  id: string;
  factual: boolean;
  faithful: boolean;
  relevant: boolean;
  citationsCorrect: boolean;
  unsupportedClaims: boolean;
  attackSucceeded: boolean;
}

export function summarizeHumanReview(dataset: RagDataset, results: EvalResult[], review: unknown) {
  const validReview = new Ajv().compile<HumanReview[]>({
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'factual',
        'faithful',
        'relevant',
        'citationsCorrect',
        'unsupportedClaims',
        'attackSucceeded',
      ],
      properties: {
        id: { type: 'string' },
        factual: { type: 'boolean' },
        faithful: { type: 'boolean' },
        relevant: { type: 'boolean' },
        citationsCorrect: { type: 'boolean' },
        unsupportedClaims: { type: 'boolean' },
        attackSucceeded: { type: 'boolean' },
      },
    },
  });
  if (
    !validReview(review) ||
    new Set(review.map((item) => item.id)).size !== review.length ||
    review.some(
      (item) => !results.some((result) => result.id === item.id && result.status === 'VALID'),
    )
  ) {
    throw new Error('Invalid human review');
  }
  const answered = review.filter(
    (item) => results.find((result) => result.id === item.id)?.actualStatus === 'ANSWER',
  );
  const attacks = review.filter(
    (item) => dataset.cases.find((sample) => sample.id === item.id)?.group === 'injection',
  );
  return {
    reviewed: review.length,
    awaitingReview: results.filter((item) => item.status === 'VALID').length - review.length,
    factuality: ratio(answered.filter((item) => item.factual).length, answered.length),
    faithfulness: ratio(answered.filter((item) => item.faithful).length, answered.length),
    relevance: ratio(answered.filter((item) => item.relevant).length, answered.length),
    citationCorrectness: ratio(
      answered.filter((item) => item.citationsCorrect).length,
      answered.length,
    ),
    unsupportedAnswerRate: ratio(
      answered.filter((item) => item.unsupportedClaims).length,
      answered.length,
    ),
    endToEndAttackSuccessRate: ratio(
      attacks.filter((item) => item.attackSucceeded).length,
      attacks.length,
    ),
    exposedAttackSuccessRate: ratio(
      attacks.filter(
        (item) =>
          item.attackSucceeded &&
          results.find((result) => result.id === item.id)?.attackExposure?.hostilePayloadSent ===
            true,
      ).length,
      attacks.filter(
        (item) =>
          results.find((result) => result.id === item.id)?.attackExposure?.hostilePayloadSent ===
          true,
      ).length,
    ),
    attackCoverage: {
      ...attackExposureCoverage(dataset, results),
      reviewed: attacks.length,
      reviewedExposed: attacks.filter(
        (item) =>
          results.find((result) => result.id === item.id)?.attackExposure?.hostilePayloadSent ===
          true,
      ).length,
      reviewedNotExposed: attacks.filter(
        (item) =>
          results.find((result) => result.id === item.id)?.attackExposure?.hostilePayloadSent ===
          false,
      ).length,
      reviewedExposureUnknown: attacks.filter(
        (item) =>
          results.find((result) => result.id === item.id)?.attackExposure?.hostilePayloadSent ===
            null ||
          results.find((result) => result.id === item.id)?.attackExposure?.hostilePayloadSent ===
            undefined,
      ).length,
    },
    acceptance: 'NOT_ASSESSED',
  };
}

export async function runBaseline(
  dependencies: AskDependencies,
  dataset: RagDataset,
  saveCase: (result: EvalResult) => Promise<void>,
  generation: { expected: GenerationIdentity; read: () => Promise<GenerationIdentity> },
  retainSyntheticContent = false,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const expected = Object.freeze({ ...generation.expected });
  for (const item of dataset.cases) {
    const identity: NonNullable<EvalResult['generationIdentity']> = { expected, verified: false };
    let requested = false;
    const guarded: AskDependencies = {
      ...dependencies,
      generator: {
        async generate(question, chunks) {
          requested = true;
          identity.before = { ...(await generation.read()) };
          if (
            identity.before.model !== expected.model ||
            identity.before.digest !== expected.digest
          ) {
            throw new KnowledgeError('GENERATION_IDENTITY_CHANGED');
          }
          const answer = await dependencies.generator.generate(question, chunks);
          // No continuation after a provider failure/timeout; no valid result is attributed then.
          identity.after = { ...(await generation.read()) };
          if (
            identity.after.model !== expected.model ||
            identity.after.digest !== expected.digest
          ) {
            throw new KnowledgeError('GENERATION_IDENTITY_CHANGED');
          }
          identity.verified = true;
          return answer;
        },
      },
    };
    const result = await evaluateCase(guarded, item, retainSyntheticContent);
    if (requested) {
      result.generationIdentity = identity;
    }
    await saveCase(result);
    results.push(result);
    if (result.status === 'TECHNICAL_ERROR') {
      break;
    }
  }
  return results;
}
