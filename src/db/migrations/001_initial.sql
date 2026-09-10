CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  collection TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  key TEXT,
  tags TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  content_hash TEXT NOT NULL,
  file_mtime_ms REAL,
  body TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_key ON documents(collection, key) WHERE key IS NOT NULL AND deleted_at IS NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
  document_id UNINDEXED, title, h1, h2, h3, h4, h5, h6, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS embedding_jobs (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, content_hash TEXT NOT NULL, model_name TEXT NOT NULL,
  status TEXT NOT NULL, claim TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
