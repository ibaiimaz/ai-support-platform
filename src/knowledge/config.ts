export interface RagConfig {
  baseUrl: string;
  databaseUrl: string;
  generationModel: string;
  embeddingModel: string;
  dimensions: number;
  topK: number;
  minSimilarity: number;
  maxContextChunks: number;
  maxQuestionLength: number;
  chunkSize: number;
  chunkOverlap: number;
  embeddingTimeoutMs: number;
  generationTimeoutMs: number;
  databaseTimeoutMs: number;
  documentsDirectory: string;
}

export function loadRagConfig(env: NodeJS.ProcessEnv = process.env): RagConfig {
  function integer(name: string, fallback: number, min: number, max: number) {
    const raw = env[name] ?? String(fallback);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) {
      throw new Error('Invalid RAG configuration');
    }
    return value;
  }

  const baseUrl = env.RAG_OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const databaseUrl =
    env.RAG_DATABASE_URL ?? 'postgresql://support:support_dev@127.0.0.1:5433/support';
  if (new URL(baseUrl).username || new URL(baseUrl).password) {
    throw new Error('RAG provider URL must not contain credentials');
  }
  if (
    !['http:', 'https:'].includes(new URL(baseUrl).protocol) ||
    !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)
  ) {
    throw new Error('Invalid RAG configuration');
  }
  const minSimilarity = Number(env.RAG_MIN_SIMILARITY ?? '0.45');
  if (
    !Number.isFinite(minSimilarity) ||
    minSimilarity < -1 ||
    minSimilarity > 1 ||
    env.RAG_MIN_SIMILARITY?.trim() === ''
  ) {
    throw new Error('Invalid RAG similarity');
  }
  const config: RagConfig = {
    baseUrl,
    databaseUrl,
    generationModel: env.RAG_GENERATION_MODEL ?? 'qwen3:8b',
    embeddingModel: env.RAG_EMBEDDING_MODEL ?? 'nomic-embed-text:latest',
    dimensions: integer('RAG_EMBEDDING_DIMENSIONS', 768, 1, 4096),
    topK: integer('RAG_TOP_K', 5, 1, 100),
    minSimilarity,
    maxContextChunks: integer('RAG_MAX_CONTEXT_CHUNKS', 4, 1, 20),
    maxQuestionLength: integer('RAG_MAX_QUESTION_LENGTH', 2000, 1, 4000),
    chunkSize: integer('RAG_CHUNK_SIZE', 1200, 100, 8000),
    chunkOverlap: integer('RAG_CHUNK_OVERLAP', 150, 0, 7999),
    embeddingTimeoutMs: integer('RAG_EMBEDDING_TIMEOUT_MS', 30000, 1, 120000),
    generationTimeoutMs: integer('RAG_GENERATION_TIMEOUT_MS', 45000, 1, 120000),
    databaseTimeoutMs: integer('RAG_DATABASE_TIMEOUT_MS', 5000, 1, 30000),
    documentsDirectory: env.RAG_DOCUMENTS_DIRECTORY ?? 'knowledge/corpus',
  };
  if (
    !config.generationModel.trim() ||
    !config.embeddingModel.trim() ||
    !config.documentsDirectory.trim() ||
    config.chunkOverlap >= config.chunkSize ||
    config.maxContextChunks > config.topK
  ) {
    throw new Error('Invalid RAG configuration');
  }
  return config;
}
