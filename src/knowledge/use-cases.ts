import { Ajv } from 'ajv';
import type {
  AnswerGenerator,
  DocumentWriter,
  EmbeddingProvider,
  KnowledgeRepository,
} from './ports.js';
import type {
  GenerationResult,
  KnowledgeAnswer,
  KnowledgeDocument,
  RetrievedChunk,
} from './domain.js';
import { KnowledgeError, validateEmbedding } from './domain.js';
import { chunkMarkdown, hash } from './markdown.js';

export const generationSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'answer', 'chunkIds'],
      properties: {
        status: { const: 'ANSWER' },
        answer: { type: 'string', pattern: '\\S', maxLength: 8000 },
        chunkIds: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'answer', 'chunkIds'],
      properties: {
        status: { const: 'INSUFFICIENT_CONTEXT' },
        answer: { type: 'null' },
        chunkIds: { type: 'array', maxItems: 0 },
      },
    },
  ],
};

const validateGeneration = new Ajv({
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
}).compile<GenerationResult>(generationSchema);

export interface AskDependencies {
  embeddings: EmbeddingProvider;
  repository: KnowledgeRepository;
  generator: AnswerGenerator;
  topK: number;
  minSimilarity: number;
  maxContextChunks: number;
}

export async function askKnowledgeQuestion(
  dependencies: AskDependencies,
  question: string,
  observeRetrieval?: (chunks: RetrievedChunk[], latencyMs: number) => void,
): Promise<KnowledgeAnswer> {
  if (!question.trim()) {
    throw new Error('Question must not be empty');
  }
  const space = await dependencies.embeddings.identity();
  const vector = await dependencies.embeddings.embed(question, space);
  validateEmbedding(vector, space.dimensions);
  return dependencies.repository.withSnapshot(async (snapshot) => {
    const started = performance.now();
    const retrieved = await snapshot.search(vector, {
      topK: dependencies.topK,
      minSimilarity: dependencies.minSimilarity,
      space,
    });
    observeRetrieval?.(
      retrieved.map((chunk) => ({ ...chunk })),
      performance.now() - started,
    );
    const context = retrieved.slice(0, dependencies.maxContextChunks);
    if (!context.length) {
      return { status: 'INSUFFICIENT_CONTEXT', answer: null, sources: [] };
    }
    const result: unknown = await dependencies.generator.generate(question, context);
    if (!validateGeneration(result)) {
      throw new KnowledgeError('INVALID_GENERATION_RESPONSE');
    }
    if (result.status === 'INSUFFICIENT_CONTEXT') {
      return { status: 'INSUFFICIENT_CONTEXT', answer: null, sources: [] };
    }
    const byId = new Map(context.map((chunk) => [chunk.chunkId, chunk]));
    if (result.chunkIds.some((id) => !byId.has(id))) {
      throw new KnowledgeError('INVALID_GENERATION_RESPONSE');
    }
    return {
      status: 'ANSWER',
      answer: result.answer,
      sources: result.chunkIds.map((id) => {
        const chunk = byId.get(id)!;
        return {
          documentId: chunk.documentId,
          versionId: chunk.versionId,
          chunkId: chunk.chunkId,
          title: chunk.title,
          section: chunk.section,
        };
      }),
    };
  });
}

export async function publishKnowledgeVersion(
  writer: DocumentWriter,
  versionId: string,
): Promise<void> {
  await writer.publish(versionId);
}

export async function ingestKnowledgeDocument(
  repository: KnowledgeRepository,
  embeddings: EmbeddingProvider,
  document: KnowledgeDocument,
  options: { chunkSize: number; chunkOverlap: number },
) {
  const fragments = chunkMarkdown(document.body, options.chunkSize, options.chunkOverlap);
  const space = await embeddings.identity();
  const configHash = hash(
    JSON.stringify({
      algorithm: 'markdown-sections-v1',
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
      space,
    }),
  );
  return repository.withDocument(document.documentId, async (writer) => {
    const active = await writer.activeMatches(document.contentHash, configHash);
    if (active) {
      return {
        documentId: document.documentId,
        versionId: active,
        status: 'UNCHANGED' as const,
        chunks: fragments.length,
      };
    }
    const versionId = await writer.begin({
      documentId: document.documentId,
      title: document.title,
      contentHash: document.contentHash,
      configHash,
      space,
      expectedChunks: fragments.length,
    });
    try {
      await writer.processing(versionId);
      const chunks = [];
      for (const fragment of fragments) {
        const vector = await embeddings.embed(fragment.content, space);
        validateEmbedding(vector, space.dimensions);
        chunks.push({
          id: `${document.documentId}:${versionId}:${fragment.position}`,
          documentVersionId: versionId,
          ...fragment,
          embedding: vector,
        });
      }
      await writer.ready(versionId, chunks);
      await publishKnowledgeVersion(writer, versionId);
      return {
        documentId: document.documentId,
        versionId,
        status: 'ACTIVE' as const,
        chunks: chunks.length,
      };
    } catch (error) {
      try {
        await writer.fail(versionId);
      } catch {
        // No publication took place; a database failure must not hide the original error.
      }
      throw error;
    }
  });
}
