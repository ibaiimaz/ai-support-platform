import { Pool } from 'pg';
import { loadRagConfig, type RagConfig } from './config.js';
import { OllamaKnowledge } from './ollama.js';
import { PostgresKnowledgeRepository } from './postgres.js';

export function createKnowledgeDependencies(config: RagConfig = loadRagConfig()) {
  const provider = new OllamaKnowledge(config);
  // Pool construction does not connect; startup never ingests or invokes a model.
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 6,
    connectionTimeoutMillis: config.databaseTimeoutMs,
    statement_timeout: config.databaseTimeoutMs,
    idle_in_transaction_session_timeout: config.generationTimeoutMs + 15000,
  });
  pool.on('error', () => {
    // Idle connection errors contain database details; never log the raw error.
  });
  let closing: Promise<void> | undefined;
  return {
    dependencies: {
      embeddings: provider,
      generator: provider,
      repository: new PostgresKnowledgeRepository(pool),
      topK: config.topK,
      minSimilarity: config.minSimilarity,
      maxContextChunks: config.maxContextChunks,
    },
    pool,
    close() {
      closing ??= Promise.resolve().then(() => pool.end());
      return closing;
    },
  };
}
