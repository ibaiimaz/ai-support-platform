import { Ajv } from 'ajv';
import { readFile } from 'node:fs/promises';
import { chunkMarkdown, hash } from '../../knowledge/markdown.js';
import type { KnowledgeDocument } from '../../knowledge/domain.js';
import type { RagDataset } from './evaluation.js';

export interface ChunkAnnotation {
  ref: string;
  documentId: string;
  documentHash: string;
  position: number;
  contentHash: string;
  section: string;
}

export interface RelevanceAnnotations {
  schemaVersion: 1;
  id: string;
  version: number;
  status: 'PROPOSED';
  datasetId: string;
  datasetVersion: number;
  datasetHash: string;
  corpusHash: string;
  chunking: { algorithm: 'markdown-sections-v1'; size: number; overlap: number };
  chunks: ChunkAnnotation[];
  cases: {
    id: string;
    status: 'ANNOTATED' | 'NO_RELEVANT_EVIDENCE' | 'NOT_APPLICABLE' | 'NOT_ANNOTATED';
    necessary: string[];
    complementary: string[];
    rationale: string;
  }[];
}

const text = { type: 'string', minLength: 1 };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const references = { type: 'array', uniqueItems: true, items: text };
const valid = new Ajv({
  coerceTypes: false,
  removeAdditional: false,
}).compile<RelevanceAnnotations>({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'version',
    'status',
    'datasetId',
    'datasetVersion',
    'datasetHash',
    'corpusHash',
    'chunking',
    'chunks',
    'cases',
  ],
  properties: {
    schemaVersion: { const: 1 },
    id: text,
    version: { type: 'integer', minimum: 1 },
    status: { const: 'PROPOSED' },
    datasetId: text,
    datasetVersion: { type: 'integer', minimum: 1 },
    datasetHash: digest,
    corpusHash: digest,
    chunking: {
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'size', 'overlap'],
      properties: {
        algorithm: { const: 'markdown-sections-v1' },
        size: { type: 'integer', minimum: 1 },
        overlap: { type: 'integer', minimum: 0 },
      },
    },
    chunks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'documentId', 'documentHash', 'position', 'contentHash', 'section'],
        properties: {
          ref: text,
          documentId: text,
          documentHash: digest,
          position: { type: 'integer', minimum: 0 },
          contentHash: digest,
          section: text,
        },
      },
    },
    cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'necessary', 'complementary', 'rationale'],
        properties: {
          id: text,
          status: {
            enum: ['ANNOTATED', 'NO_RELEVANT_EVIDENCE', 'NOT_APPLICABLE', 'NOT_ANNOTATED'],
          },
          necessary: references,
          complementary: references,
          rationale: text,
        },
      },
    },
  },
});

export function corpusIdentity(documents: KnowledgeDocument[]) {
  return hash(
    JSON.stringify(documents.map(({ documentId, contentHash }) => ({ documentId, contentHash }))),
  );
}

export function validateAnnotations(
  value: unknown,
  dataset: RagDataset,
  datasetHash: string,
  documents: KnowledgeDocument[],
  chunking: { size: number; overlap: number },
): asserts value is RelevanceAnnotations {
  if (
    !valid(value) ||
    value.datasetId !== dataset.datasetId ||
    value.datasetVersion !== dataset.contentVersion ||
    value.datasetHash !== datasetHash ||
    value.corpusHash !== corpusIdentity(documents) ||
    value.chunking.size !== chunking.size ||
    value.chunking.overlap !== chunking.overlap
  ) {
    throw new Error('Incompatible relevance annotations');
  }
  const catalog = documents.flatMap((document) =>
    chunkMarkdown(document.body, chunking.size, chunking.overlap).map((chunk) => ({
      ref: `${document.documentId}:${chunk.position}`,
      documentId: document.documentId,
      documentHash: document.contentHash,
      position: chunk.position,
      contentHash: hash(chunk.content),
      section: chunk.section,
    })),
  );
  if (
    value.chunks.length !== catalog.length ||
    new Set(value.chunks.map((c) => c.ref)).size !== catalog.length ||
    value.chunks.some(
      (c) =>
        !catalog.some((expected) =>
          Object.entries(expected).every(
            ([key, field]) => c[key as keyof ChunkAnnotation] === field,
          ),
        ),
    )
  ) {
    throw new Error('Invalid annotation chunk catalog');
  }
  if (
    value.cases.length !== dataset.cases.length ||
    new Set(value.cases.map((c) => c.id)).size !== dataset.cases.length
  ) {
    throw new Error('Invalid annotation cases');
  }
  for (const item of value.cases) {
    const sample = dataset.cases.find((c) => c.id === item.id);
    const refs = [...item.necessary, ...item.complementary];
    if (
      !sample ||
      refs.some((ref) => !catalog.some((c) => c.ref === ref)) ||
      new Set(refs).size !== refs.length ||
      (item.status === 'ANNOTATED'
        ? !item.necessary.length || sample.expectedStatus !== 'ANSWER'
        : refs.length !== 0) ||
      (item.status === 'NO_RELEVANT_EVIDENCE' && sample.expectedStatus !== 'INSUFFICIENT_CONTEXT')
    ) {
      throw new Error('Invalid annotation relevance');
    }
  }
}

export async function loadAnnotations(
  dataset: RagDataset,
  datasetHash: string,
  documents: KnowledgeDocument[],
  chunking: { size: number; overlap: number },
) {
  const path = 'evals/knowledge/i007-chunk-annotations-v2.json';
  const bytes = await readFile(path);
  const annotations: unknown = JSON.parse(bytes.toString('utf8'));
  validateAnnotations(annotations, dataset, datasetHash, documents, chunking);
  return {
    annotations,
    identity: { path, id: annotations.id, version: annotations.version, sha256: hash(bytes) },
  };
}

export function referenceForChunk(id: string, annotations: RelevanceAnnotations) {
  const parts = /^([^:]+):([^:]+):(0|[1-9][0-9]*)$/.exec(id);
  return parts
    ? (annotations.chunks.find(
        (c) => c.documentId === parts[1] && c.position === Number(parts[3]),
      ) ?? null)
    : null;
}
