export interface GenerationIdentity {
  model: string;
  digest: string;
}

export interface EmbeddingSpace {
  model: string;
  digest: string;
  dimensions: number;
}

export interface KnowledgeDocument {
  documentId: string;
  title: string;
  contentHash: string;
  body: string;
}

export interface KnowledgeChunk {
  id: string;
  documentVersionId: string;
  section: string;
  position: number;
  content: string;
  embedding: number[];
}

export interface Source {
  documentId: string;
  versionId: string;
  chunkId: string;
  title: string;
  section: string;
}

export interface RetrievedChunk extends Source {
  content: string;
  similarity: number;
}

export type KnowledgeAnswer =
  | { status: 'ANSWER'; answer: string; sources: Source[] }
  | { status: 'INSUFFICIENT_CONTEXT'; answer: null; sources: [] };

export type GenerationResult =
  | { status: 'ANSWER'; answer: string; chunkIds: string[] }
  | { status: 'INSUFFICIENT_CONTEXT'; answer: null; chunkIds: [] };

export const knowledgeErrorKinds = [
  'DATABASE_UNAVAILABLE',
  'EMBEDDING_UNAVAILABLE',
  'GENERATION_UNAVAILABLE',
  'GENERATION_IDENTITY_CHANGED',
  'EMBEDDING_TIMEOUT',
  'GENERATION_TIMEOUT',
  'INVALID_EMBEDDING_RESPONSE',
  'INVALID_GENERATION_RESPONSE',
  'INGESTION_BUSY',
] as const;

export class KnowledgeError extends Error {
  constructor(readonly kind: (typeof knowledgeErrorKinds)[number]) {
    super('Knowledge operation failed');
  }
}

export function validateEmbedding(vector: unknown, dimensions: number): asserts vector is number[] {
  if (
    !Array.isArray(vector) ||
    vector.length !== dimensions ||
    vector.some(
      (n) => typeof n !== 'number' || !Number.isFinite(n) || !Number.isFinite(Math.fround(n)),
    ) ||
    !vector.some((n: number) => Math.fround(n) !== 0)
  ) {
    throw new KnowledgeError('INVALID_EMBEDDING_RESPONSE');
  }
}
