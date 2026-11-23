CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE knowledge_documents (
  document_id text PRIMARY KEY,
  active_version uuid
);
CREATE TABLE knowledge_versions (
  id uuid PRIMARY KEY,
  document_id text NOT NULL REFERENCES knowledge_documents(document_id),
  title text NOT NULL CHECK (length(title) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('PENDING','PROCESSING','READY','ACTIVE','FAILED')),
  embedding_model text NOT NULL,
  embedding_digest text NOT NULL,
  embedding_dimensions integer NOT NULL CHECK (embedding_dimensions > 0),
  expected_chunks integer NOT NULL CHECK (expected_chunks > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, embedding_dimensions),
  UNIQUE (id, document_id)
);
ALTER TABLE knowledge_documents ADD CONSTRAINT active_document_version
  FOREIGN KEY (active_version, document_id) REFERENCES knowledge_versions(id, document_id);
CREATE UNIQUE INDEX knowledge_one_active ON knowledge_versions(document_id) WHERE status = 'ACTIVE';
CREATE TABLE knowledge_chunks (
  id text PRIMARY KEY,
  version_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  section text NOT NULL,
  content text NOT NULL CHECK (length(trim(content)) > 0),
  embedding_dimensions integer NOT NULL,
  embedding vector NOT NULL,
  FOREIGN KEY (version_id, embedding_dimensions) REFERENCES knowledge_versions(id, embedding_dimensions) ON DELETE CASCADE,
  CHECK (vector_dims(embedding) = embedding_dimensions),
  UNIQUE (version_id, position)
);
-- No HNSW/IVFFlat index: retrieval deliberately uses exact cosine distance.
