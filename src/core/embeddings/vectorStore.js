/**
 * Vector storage using sqlite-vec. Loaded dynamically so it's optional.
 */
import { getDb } from '../../db/sqlite.js';

const MODEL_SUFFIX = 'Xenova_multilingual_e5_large';

function getCacheTableName() {
  return `vec_cache_${MODEL_SUFFIX}`;
}

function getVecTableName() {
  return `vec_${MODEL_SUFFIX}`;
}

let sqliteVecLoaded = false;

async function ensureSqliteVecLoaded(config) {
  if (sqliteVecLoaded) return;
  try {
    const sqliteVec = await import('sqlite-vec');
    const db = getDb(config);
    sqliteVec.load(db);
    sqliteVecLoaded = true;
  } catch (_) {
    throw new Error('sqlite-vec not available');
  }
}

async function ensureTables(config) {
  const db = getDb(config);
  const cacheTable = getCacheTableName();
  const vecTable = getVecTableName();
  const exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(cacheTable);
  if (exists) return;
  await ensureSqliteVecLoaded(config);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${cacheTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT NOT NULL UNIQUE,
      document_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${vecTable} USING vec0(
      embedding float[1024] distance_metric=cosine
    )
  `);
}

/**
 * Insert a vector for a chunk. Call after embedding the chunk content.
 */
async function insert(config, { chunk_id, document_id, content_hash, embedding }) {
  if (!config?.embeddings?.enabled) return;
  await ensureTables(config);
  const db = getDb(config);
  const cacheTable = getCacheTableName();
  const vecTable = getVecTableName();
  const now = new Date().toISOString();
  const model = config.embeddings?.model || MODEL_SUFFIX;
  const emb = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  db.prepare(`INSERT INTO ${vecTable} (embedding) VALUES (?)`).run(emb);
  const rawId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  const id = typeof rawId === 'bigint' ? Number(rawId) : parseInt(rawId, 10);
  db.prepare(
    `INSERT INTO ${cacheTable} (id, chunk_id, document_id, content_hash, embedding_model, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, chunk_id, document_id, content_hash, model, now);
}

/**
 * KNN search. Returns [{ chunk_id, document_id, distance }]. distance is cosine distance (0 = identical).
 */
async function search(config, queryEmbedding, k = 20, options = {}) {
  if (!config?.embeddings?.enabled) return [];
  await ensureTables(config);
  const db = getDb(config);
  const cacheTable = getCacheTableName();
  const vecTable = getVecTableName();
  const emb = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);
  const rows = db.prepare(
    `SELECT v.rowid, v.distance, c.chunk_id, c.document_id
     FROM ${vecTable} v
     JOIN ${cacheTable} c ON c.id = v.rowid
     WHERE v.embedding MATCH ? AND k = ?`
  ).all(emb, Math.min(k, 100));
  const threshold = options.similarityThreshold ?? config.embeddings?.similarityThreshold ?? 0.80;
  return rows
    .filter((r) => (1 - r.distance) >= threshold)
    .map((r) => ({ chunk_id: r.chunk_id, document_id: r.document_id, distance: r.distance }));
}

/**
 * Remove vectors for given chunk ids (e.g. on document update/invalidation).
 */
async function removeChunks(config, chunkIds) {
  if (!chunkIds?.length || !config?.embeddings?.enabled) return;
  await ensureTables(config);
  const db = getDb(config);
  const cacheTable = getCacheTableName();
  const vecTable = getVecTableName();
  for (const cid of chunkIds) {
    const row = db.prepare(`SELECT id FROM ${cacheTable} WHERE chunk_id = ?`).get(cid);
    if (row) {
      db.prepare(`DELETE FROM ${vecTable} WHERE rowid = ?`).run(row.id);
      db.prepare(`DELETE FROM ${cacheTable} WHERE id = ?`).run(row.id);
    }
  }
}

export async function getVectorStore(config) {
  if (!config?.embeddings?.enabled) return null;
  try {
    await ensureSqliteVecLoaded(config);
    return { insert, search, removeChunks, ensureTables };
  } catch {
    return null;
  }
}

export { insert, search, removeChunks, ensureTables, getCacheTableName, getVecTableName };
