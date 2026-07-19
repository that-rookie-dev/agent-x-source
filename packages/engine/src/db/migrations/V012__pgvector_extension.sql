-- Optional pgvector support. The application degrades gracefully to an
-- in-memory vector store if the extension is not available.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS knowledge_chunk_vectors (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      -- 1536 is the default OpenAI/Ada-2 dimension; the application enforces the
      -- configured dimension at insert time.
      embedding vector(1536)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_vectors_source ON knowledge_chunk_vectors(source_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_vectors_embedding ON knowledge_chunk_vectors USING ivfflat (embedding vector_cosine_ops);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- pgvector is not installed; the application will fall back to MemoryVectorStore.
    NULL;
END $$;
