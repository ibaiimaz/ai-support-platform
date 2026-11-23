import type { AskDependencies } from '../../src/knowledge/use-cases.js';
import type {
  EmbeddingProvider,
  KnowledgeRepository,
  DocumentWriter,
} from '../../src/knowledge/ports.js';
import type { RetrievedChunk } from '../../src/knowledge/domain.js';

export const space = { model: 'synthetic:1', digest: 'a'.repeat(64), dimensions: 3 };

export const chunk: RetrievedChunk = {
  documentId: 'access',
  versionId: 'v1',
  chunkId: 'c1',
  title: 'Acceso',
  section: 'Bloqueos',
  content: 'La cuenta se bloquea durante 15 minutos.',
  similarity: 1,
};

export const embeddings: EmbeddingProvider = {
  async identity() {
    return space;
  },
  async embed() {
    return [1, 0, 0];
  },
};

export function dependencies(chunks: RetrievedChunk[] = [chunk]): AskDependencies {
  return {
    embeddings,
    repository: {
      async withDocument<T>(
        _id: string,
        _action: (writer: DocumentWriter) => Promise<T>,
      ): Promise<T> {
        throw new Error('Not used');
      },
      async withSnapshot(action) {
        return action({
          async search() {
            return chunks;
          },
        });
      },
    },
    generator: {
      async generate() {
        return { status: 'ANSWER', answer: '15 minutos.', chunkIds: ['c1'] };
      },
    },
    topK: 5,
    minSimilarity: 0.45,
    maxContextChunks: 4,
  };
}

export function repository(writer: DocumentWriter): KnowledgeRepository {
  return {
    async withDocument(_id, action) {
      return action(writer);
    },
    async withSnapshot() {
      throw new Error('Not used');
    },
  };
}
