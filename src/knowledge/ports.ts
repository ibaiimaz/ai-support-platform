import type { EmbeddingSpace, KnowledgeChunk, RetrievedChunk, GenerationResult } from './domain.js';

export interface SearchOptions {
  topK: number;
  minSimilarity: number;
  space: EmbeddingSpace;
}

export interface VersionMetadata {
  documentId: string;
  title: string;
  contentHash: string;
  configHash: string;
  space: EmbeddingSpace;
  expectedChunks: number;
}

export interface DocumentWriter {
  activeMatches(contentHash: string, configHash: string): Promise<string | null>;
  begin(metadata: VersionMetadata): Promise<string>;
  processing(versionId: string): Promise<void>;
  ready(versionId: string, chunks: KnowledgeChunk[]): Promise<void>;
  publish(versionId: string): Promise<void>;
  fail(versionId: string): Promise<void>;
}

export interface KnowledgeRepository {
  withDocument<T>(documentId: string, action: (writer: DocumentWriter) => Promise<T>): Promise<T>;
  withSnapshot<T>(
    action: (snapshot: {
      search(embedding: number[], options: SearchOptions): Promise<RetrievedChunk[]>;
    }) => Promise<T>,
  ): Promise<T>;
}

export interface EmbeddingProvider {
  identity(): Promise<EmbeddingSpace>;
  embed(text: string, space: EmbeddingSpace): Promise<number[]>;
}

export interface AnswerGenerator {
  generate(question: string, chunks: RetrievedChunk[]): Promise<GenerationResult>;
}
