import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { KnowledgeError, validateEmbedding, type RetrievedChunk } from './domain.js';
import type { DocumentWriter, KnowledgeRepository, SearchOptions } from './ports.js';
import { hash } from './markdown.js';

async function transaction<T>(
  client: PoolClient,
  action: () => Promise<T>,
  readOnly = false,
): Promise<T> {
  await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
  try {
    const result = await action();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  private readonly broken = new WeakSet<PoolClient>();

  constructor(readonly pool: Pool) {}

  private async connected<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      return await action(client);
    } catch (error) {
      if (error instanceof KnowledgeError) {
        throw error;
      }
      throw new KnowledgeError('DATABASE_UNAVAILABLE');
    } finally {
      if (client) {
        client.release(this.broken.has(client));
      }
    }
  }

  async withDocument<T>(
    documentId: string,
    action: (writer: DocumentWriter) => Promise<T>,
  ): Promise<T> {
    return this.connected(async (client) => {
      const lock = `i007-document:${documentId}`;
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [lock],
      );
      if (!result.rows[0]?.locked) {
        throw new KnowledgeError('INGESTION_BUSY');
      }
      try {
        const writer: DocumentWriter = {
          activeMatches: async (contentHash, configHash) => {
            const active = await client.query<{ id: string }>(
              `SELECT v.id FROM knowledge_documents d JOIN knowledge_versions v ON v.id = d.active_version WHERE d.document_id=$1 AND v.status='ACTIVE' AND v.content_hash=$2 AND v.config_hash=$3`,
              [documentId, contentHash, configHash],
            );
            return active.rows[0]?.id ?? null;
          },
          begin: async (metadata) =>
            transaction(client, async () => {
              if (metadata.documentId !== documentId) {
                throw new Error('Document mismatch');
              }
              await client.query(
                'INSERT INTO knowledge_documents(document_id) VALUES ($1) ON CONFLICT DO NOTHING',
                [documentId],
              );
              await client.query(
                'DELETE FROM knowledge_versions WHERE document_id=$1 AND id IS DISTINCT FROM (SELECT active_version FROM knowledge_documents WHERE document_id=$1)',
                [documentId],
              );
              const id = randomUUID();
              await client.query(
                `INSERT INTO knowledge_versions(id,document_id,title,content_hash,config_hash,status,embedding_model,embedding_digest,embedding_dimensions,expected_chunks) VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9)`,
                [
                  id,
                  documentId,
                  metadata.title,
                  metadata.contentHash,
                  metadata.configHash,
                  metadata.space.model,
                  metadata.space.digest,
                  metadata.space.dimensions,
                  metadata.expectedChunks,
                ],
              );
              return id;
            }),
          processing: async (id) => {
            const updated = await client.query(
              "UPDATE knowledge_versions SET status='PROCESSING' WHERE id=$1 AND document_id=$2 AND status='PENDING'",
              [id, documentId],
            );
            if (updated.rowCount !== 1) {
              throw new Error('Invalid version transition');
            }
          },
          ready: async (id, chunks) =>
            transaction(client, async () => {
              const version = await client.query<{
                expected_chunks: number;
                embedding_dimensions: number;
              }>(
                "SELECT expected_chunks,embedding_dimensions FROM knowledge_versions WHERE id=$1 AND document_id=$2 AND status='PROCESSING' FOR UPDATE",
                [id, documentId],
              );
              const metadata = version.rows[0];
              if (!metadata || chunks.length !== metadata.expected_chunks) {
                throw new Error('Incomplete version');
              }
              for (const [position, chunk] of chunks.entries()) {
                validateEmbedding(chunk.embedding, metadata.embedding_dimensions);
                if (chunk.documentVersionId !== id || chunk.position !== position) {
                  throw new Error('Chunk mismatch');
                }
                await client.query(
                  'INSERT INTO knowledge_chunks(id,version_id,position,section,content,embedding_dimensions,embedding) VALUES($1,$2,$3,$4,$5,$6,$7::vector)',
                  [
                    chunk.id,
                    id,
                    position,
                    chunk.section,
                    chunk.content,
                    metadata.embedding_dimensions,
                    JSON.stringify(chunk.embedding),
                  ],
                );
              }
              await client.query("UPDATE knowledge_versions SET status='READY' WHERE id=$1", [id]);
            }),
          publish: async (id) =>
            transaction(client, async () => {
              await client.query(
                'SELECT document_id FROM knowledge_documents WHERE document_id=$1 FOR UPDATE',
                [documentId],
              );
              const valid = await client.query(
                `SELECT v.id FROM knowledge_versions v WHERE v.id=$1 AND v.document_id=$2 AND v.status='READY' AND v.expected_chunks=(SELECT count(*) FROM knowledge_chunks c WHERE c.version_id=v.id)`,
                [id, documentId],
              );
              if (valid.rowCount !== 1) {
                throw new Error('Version not ready');
              }
              await client.query(
                'UPDATE knowledge_documents SET active_version=NULL WHERE document_id=$1',
                [documentId],
              );
              await client.query('DELETE FROM knowledge_versions WHERE document_id=$1 AND id<>$2', [
                documentId,
                id,
              ]);
              await client.query("UPDATE knowledge_versions SET status='ACTIVE' WHERE id=$1", [id]);
              await client.query(
                'UPDATE knowledge_documents SET active_version=$2 WHERE document_id=$1',
                [documentId, id],
              );
            }),
          fail: async (id) => {
            await client.query(
              "UPDATE knowledge_versions SET status='FAILED' WHERE id=$1 AND document_id=$2 AND status IN ('PENDING','PROCESSING','READY')",
              [id, documentId],
            );
          },
        };
        return await action(writer);
      } finally {
        // A failed unlock destroys the connection, so a pooled session cannot retain this lock.
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lock]);
        } catch {
          this.broken.add(client);
          throw new KnowledgeError('DATABASE_UNAVAILABLE');
        }
      }
    });
  }

  async withSnapshot<T>(
    action: (snapshot: {
      search(embedding: number[], options: SearchOptions): Promise<RetrievedChunk[]>;
    }) => Promise<T>,
  ): Promise<T> {
    return this.connected(async (client) =>
      transaction(
        client,
        async () =>
          action({
            search: async (embedding: number[], options: SearchOptions) => {
              validateEmbedding(embedding, options.space.dimensions);
              const result = await client.query<RetrievedChunk>(
                `WITH eligible AS MATERIALIZED (SELECT d.document_id, v.id AS version_id, v.title, c.id, c.section, c.content, c.embedding FROM knowledge_documents d JOIN knowledge_versions v ON v.id=d.active_version JOIN knowledge_chunks c ON c.version_id=v.id WHERE v.status='ACTIVE' AND v.embedding_model=$2 AND v.embedding_digest=$3 AND v.embedding_dimensions=$4) SELECT document_id AS "documentId", version_id AS "versionId", id AS "chunkId", title, section, content, (1-(embedding <=> $1::vector)) AS similarity FROM eligible WHERE (1-(embedding <=> $1::vector)) >= $5 ORDER BY embedding <=> $1::vector, id LIMIT $6`,
                [
                  JSON.stringify(embedding),
                  options.space.model,
                  options.space.digest,
                  options.space.dimensions,
                  options.minSimilarity,
                  options.topK,
                ],
              );
              return result.rows;
            },
          }),
        true,
      ),
    );
  }
}

export async function migrateKnowledge(
  pool: Pool,
  path = 'migrations/007-knowledge.sql',
): Promise<void> {
  const sql = await readFile(path, 'utf8');
  const client = await pool.connect();
  try {
    await transaction(client, async () => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('i007-migration',0))");
      await client.query(
        'CREATE TABLE IF NOT EXISTS knowledge_migrations (name text PRIMARY KEY, sha256 text NOT NULL)',
      );
      const existing = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM knowledge_migrations WHERE name=$1',
        ['007'],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== hash(sql)) {
          throw new Error('Applied migration differs from disk');
        }
        return;
      }
      await client.query(sql);
      await client.query('INSERT INTO knowledge_migrations VALUES($1,$2)', ['007', hash(sql)]);
    });
  } finally {
    client.release();
  }
}
