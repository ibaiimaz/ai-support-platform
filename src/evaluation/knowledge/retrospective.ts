import { Ajv } from 'ajv';
import { execFileSync } from 'node:child_process';
import { hash } from '../../knowledge/markdown.js';
import type { RagDataset, EvalResult } from './evaluation.js';
import { referenceForChunk, type RelevanceAnnotations } from './annotations.js';
import { newObservation, summarizeDiagnostics } from './observability.js';

interface HistoricalReport {
  schemaVersion: 1 | 2;
  runId: string;
  datasetHash: string;
  corpusHash: string;
  codeHash?: string;
  config?: { chunkSize?: number; chunkOverlap?: number; chunkingAlgorithm?: string };
  activeVersions: { documentId: string; versionId: string }[];
  results: EvalResult[];
}

const validReport = new Ajv({ coerceTypes: false }).compile<HistoricalReport>({
  type: 'object',
  required: ['schemaVersion', 'runId', 'datasetHash', 'corpusHash', 'activeVersions', 'results'],
  properties: {
    schemaVersion: { enum: [1, 2] },
    runId: { type: 'string', minLength: 1 },
    datasetHash: { type: 'string' },
    corpusHash: { type: 'string' },
    codeHash: { type: 'string' },
    config: {
      type: 'object',
      properties: {
        chunkSize: { type: 'integer', minimum: 1 },
        chunkOverlap: { type: 'integer', minimum: 0 },
        chunkingAlgorithm: { type: 'string' },
      },
    },
    activeVersions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['documentId', 'versionId'],
        properties: {
          documentId: { type: 'string' },
          versionId: { type: 'string' },
        },
      },
    },
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status', 'retrievalLatencyMs', 'retrievedChunkIds'],
        properties: {
          id: { type: 'string' },
          status: { enum: ['VALID', 'TECHNICAL_ERROR'] },
          retrievalLatencyMs: { type: ['number', 'null'] },
          retrievedChunkIds: { type: 'array', uniqueItems: true, items: { type: 'string' } },
          reviewContent: {
            type: 'object',
            required: ['context', 'answer'],
            properties: {
              answer: {
                type: 'object',
                required: ['status', 'answer', 'sources'],
                properties: {
                  status: { enum: ['ANSWER', 'INSUFFICIENT_CONTEXT'] },
                  answer: { type: ['string', 'null'] },
                  sources: { type: 'array' },
                },
              },
              context: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['chunkId', 'content'],
                  properties: {
                    chunkId: { type: 'string' },
                    content: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

// Original source identities retained by baseline/A/B, not identities of the current tree.
const historicalChunkers = [
  {
    codeHash: '36128a4e8729b762695c75d7861409faec6fbb32a7a1f540ade590a9bbc876a9',
    commit: 'abbcd45b672eea725299f6a2c6101d6232cb2648',
    algorithm: 'markdown-sections-v1',
  },
  {
    codeHash: 'ec1b50a57424b1b7cee0121871da6474e3e281c683bc3d4f973e7d39d666ee11',
    commit: 'ccb0b57f020cf8ade62b35899fa7a9955d5a0abe',
    algorithm: 'markdown-sections-v1',
  },
] as const;

function verifyHistoricalChunking(report: HistoricalReport, annotations: RelevanceAnnotations) {
  const { chunkSize, chunkOverlap, chunkingAlgorithm } = report.config ?? {};
  if (chunkSize !== annotations.chunking.size || chunkOverlap !== annotations.chunking.overlap) {
    throw new Error('Historical chunking configuration missing or incompatible');
  }
  const evidence = historicalChunkers.find((item) => item.codeHash === report.codeHash);
  if (!evidence) {
    throw new Error('Historical chunking algorithm cannot be established');
  }
  const names = [
    'domain.ts',
    'ports.ts',
    'config.ts',
    'markdown.ts',
    'ollama.ts',
    'postgres.ts',
    'use-cases.ts',
    'evaluation.ts',
    'evaluation-main.ts',
    'composition.ts',
  ];
  let files: { path: string; sha256: string }[];
  try {
    files = names.map((name) => ({
      path: 'src/knowledge/' + name,
      sha256: hash(
        execFileSync('git', ['show', evidence.commit + ':src/knowledge/' + name], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
        }),
      ),
    }));
  } catch {
    throw new Error('Historical Git chunking evidence unavailable');
  }
  if (
    hash(files.map((file, index) => names[index] + ':' + file.sha256).join('\n')) !==
    report.codeHash
  ) {
    throw new Error('Historical source identity differs from report');
  }
  if (
    evidence.algorithm !== annotations.chunking.algorithm ||
    (chunkingAlgorithm !== undefined && chunkingAlgorithm !== evidence.algorithm)
  ) {
    throw new Error('Historical chunking algorithm incompatible');
  }
  return {
    algorithm: evidence.algorithm,
    size: chunkSize,
    overlap: chunkOverlap,
    establishedBy: 'EVALUATOR_CONFIG_AND_VERIFIED_GIT_SOURCE_ONLY',
    ingestionIdentity: 'NOT_RETAINED',
    commit: evidence.commit,
    codeHash: evidence.codeHash,
    sourceFiles: files,
  };
}

export function analyzeHistoricalReport(
  bytes: Uint8Array,
  dataset: RagDataset,
  annotations: RelevanceAnnotations,
) {
  const report: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (
    !validReport(report) ||
    report.datasetHash !== annotations.datasetHash ||
    report.corpusHash !== annotations.corpusHash ||
    new Set(report.activeVersions.map((v) => v.documentId)).size !== report.activeVersions.length
  ) {
    throw new Error('Incompatible historical report');
  }
  const historicalChunking = verifyHistoricalChunking(report, annotations);
  const mappedResults = report.results.map((result) => {
    if (
      result.status === 'VALID' &&
      ((result.actualStatus !== 'ANSWER' && result.actualStatus !== 'INSUFFICIENT_CONTEXT') ||
        (result.reviewContent && result.reviewContent.answer.status !== result.actualStatus))
    ) {
      throw new Error('Historical completion is inconsistent');
    }
    const observation = newObservation();
    const verifiedRef = (id: string) => {
      const reference = referenceForChunk(id, annotations);
      const parts = id.split(':');
      if (
        !reference ||
        !report.activeVersions.some(
          (v) => v.documentId === reference.documentId && v.versionId === parts[1],
        )
      ) {
        observation.mappingValid = false;
        return null;
      }
      return reference;
    };
    const context = result.reviewContent?.context;
    if (result.retrievalLatencyMs !== null) {
      observation.retrieval = result.retrievedChunkIds.map((id, index) => ({
        chunkId: id,
        stableRef: (() => {
          const reference = referenceForChunk(id, annotations);
          const retained = context?.find((chunk) => chunk.chunkId === id);
          const version = report.activeVersions.some(
            (item) =>
              item.documentId === reference?.documentId && item.versionId === id.split(':')[1],
          );
          if (
            !reference ||
            !version ||
            !retained ||
            hash(retained.content) !== reference.contentHash
          ) {
            observation.retrievalIdentityReason = 'RETRIEVED_CHUNK_CONTENT_UNVERIFIED';
            return null;
          }
          return reference.ref;
        })(),
        rank: index + 1,
        similarity: null,
        includedInContext: null,
      }));
    }
    if (context) {
      if (
        new Set(context.map((c) => c.chunkId)).size !== context.length ||
        context.some((c) => !result.retrievedChunkIds.includes(c.chunkId))
      ) {
        throw new Error('Historical context differs from retrieval');
      }
      observation.contextRefs = context.flatMap((chunk) => {
        const reference = verifiedRef(chunk.chunkId);
        if (!reference || hash(chunk.content) !== reference.contentHash) {
          observation.mappingValid = false;
          return [];
        }
        return [reference.ref];
      });
      for (const chunk of observation.retrieval ?? []) {
        chunk.includedInContext = context.some((c) => c.chunkId === chunk.chunkId);
      }
      observation.generation = context.length
        ? result.status === 'VALID'
          ? 'COMPLETED'
          : 'UNCONFIRMED'
        : 'NOT_REQUESTED';
      observation.payloadMatches = dataset.cases.flatMap((sample) =>
        (sample.hostilePayloads ?? []).flatMap((payload) => {
          const matched = context.filter(
            (chunk) =>
              chunk.chunkId.startsWith(payload.documentId + ':') &&
              chunk.content.includes(payload.text),
          );
          return matched.length
            ? [
                {
                  payloadId: payload.id,
                  originCaseId: sample.id,
                  chunkIds: matched.map((c) => c.chunkId),
                },
              ]
            : [];
        }),
      );
    } else if (observation.retrieval?.length === 0) {
      observation.contextRefs = [];
      observation.payloadMatches = [];
    }
    return { ...result, observation };
  });
  return {
    schemaVersion: 1,
    kind: 'DERIVED_RETROSPECTIVE_DIAGNOSTICS',
    historicalChunking,
    original: { runId: report.runId, schemaVersion: report.schemaVersion, sha256: hash(bytes) },
    diagnostics: summarizeDiagnostics(dataset, mappedResults, annotations),
    limitations: [
      'Historical similarity scores were not retained and remain null; ranking uses only ordered retrieved IDs.',
      'Context is used only when retained, never reconstructed from Top-K or context configuration.',
      'Evaluator identity does not establish ingestion identity; no historical ingestion fingerprint is retained.',
      'Retrieved stable references require matching retained content hashes and active versions; otherwise recall is unavailable.',
      'Context coverage uses independently verified retained content hashes.',
      'Presence of evidence does not demonstrate semantic utilization or functional correctness.',
      'Oracle Context is not an ordinary RAG report and is not included.',
    ],
  };
}
