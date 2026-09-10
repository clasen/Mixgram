import { getDb } from '../../db/sqlite.js';
import { documentFilter } from '../search/search.js';

const loaded = new WeakSet();

async function ensureTables(config) {
  const db = getDb(config);
  if (!loaded.has(db)) {
    const vec = await import('sqlite-vec');
    vec.load(db);
    loaded.add(db);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS document_vectors (
    document_id TEXT NOT NULL, model TEXT NOT NULL, content_hash TEXT NOT NULL, embedding BLOB NOT NULL,
    PRIMARY KEY(document_id,model)
  )`);
  return db;
}

function vectorBytes(config, vector) {
  if (vector.length !== config.embeddings.dimensions || !Array.from(vector).every(Number.isFinite)) throw new Error('Invalid embedding dimensions or values');
  return new Float32Array(vector);
}

async function insert(config, { id, content_hash, embedding }) {
  const db = await ensureTables(config);
  db.prepare(`INSERT INTO document_vectors VALUES (?,?,?,?) ON CONFLICT(document_id,model)
    DO UPDATE SET content_hash=excluded.content_hash,embedding=excluded.embedding`)
    .run(id, config.embeddings.model, content_hash, vectorBytes(config, embedding));
}

async function search(config, vector, options = {}) {
  const db = await ensureTables(config);
  const filter = documentFilter(config, options);
  return db.prepare(`SELECT d.*,vec_distance_cosine(v.embedding,?) AS distance
    FROM document_vectors v JOIN documents d ON d.id=v.document_id AND d.content_hash=v.content_hash
    WHERE v.model=? AND ${filter.sql} AND distance <= ? ORDER BY distance,d.id`)
    .all(vectorBytes(config, vector), config.embeddings.model, ...filter.params, 1 - config.embeddings.similarityThreshold);
}

export async function getVectorStore(config) {
  if (!config.embeddings.enabled) return null;
  await ensureTables(config);
  return { insert, search };
}
