import { getDb } from '../../db/sqlite.js';
import { normalizeForFts } from '../indexing/indexer.js';

export function documentFilter(config, { collection, type, tags = [] } = {}) {
  if (collection && !Object.hasOwn(config.collections, collection)) throw new Error('Unknown collection');
  const conditions = ['d.deleted_at IS NULL'];
  const params = [];
  const collections = collection ? [collection] : Object.keys(config.collections);
  conditions.push(`d.collection IN (${collections.map(() => '?').join(',')})`);
  params.push(...collections);
  if (type) { conditions.push('d.type = ?'); params.push(type); }
  for (const tag of new Set(tags)) {
    conditions.push('EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?)');
    params.push(tag);
  }
  return { sql: conditions.join(' AND '), params };
}

function normalizeQuery(query) {
  let text = normalizeForFts(query.trim().replace(/\//g, ' ').replace(/(?<=\w)[-\u2010-\u2015\u2212](?=\w)/g, ' '));
  for (const op of ['and', 'or', 'not']) text = text.replace(new RegExp(`\\b${op}\\b`, 'g'), op.toUpperCase());
  return text;
}

function resultRow(config, row, score) {
  return {
    id: row.id, title: row.title, collection: row.collection, type: row.type, key: row.key,
    tags: JSON.parse(row.tags), created_at: row.created_at, updated_at: row.updated_at,
    snippet: row.body.slice(0, config.search.snippetLength), ...(score === undefined ? {} : { score })
  };
}

export async function search(config, options = {}) {
  const db = getDb(config);
  const filter = documentFilter(config, options);
  const query = options.query?.trim();
  const limit = options.limit ?? config.search.defaultLimit;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > config.search.maxLimit || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid pagination');
  if (!query) {
    const rows = db.prepare(`SELECT d.* FROM documents d WHERE ${filter.sql} ORDER BY d.updated_at DESC,d.id ASC LIMIT ? OFFSET ?`).all(...filter.params, limit, offset);
    return { results: rows.map(row => resultRow(config, row)), mode: 'recent', degraded: false };
  }
  const weights = [0, ...Object.values(config.indexing.ftsWeights)].join(',');
  const textRows = db.prepare(`SELECT d.*,bm25(document_fts,${weights}) AS rank FROM document_fts
    JOIN documents d ON d.id=document_fts.document_id WHERE document_fts MATCH ? AND ${filter.sql}
    ORDER BY rank,d.id`).all(normalizeQuery(query), ...filter.params);
  let semanticRows = [];
  let degraded = false;
  let reason;
  if (config.embeddings.enabled) {
    try {
      if (!config.getQueryEmbedding) throw new Error('Embedding worker unavailable');
      const { getVectorStore } = await import('../embeddings/vectorStore.js');
      const store = await getVectorStore(config);
      if (!store) throw new Error('Vector store unavailable');
      const vector = await config.getQueryEmbedding(query);
      if (!vector) throw new Error('Query embedding unavailable');
      semanticRows = await store.search(config, vector, options);
    } catch (error) { degraded = true; reason = error.message; }
  }
  const scores = new Map();
  const add = (rows, weight) => rows.forEach((row, i) => {
    const entry = scores.get(row.id) ?? { row, score: 0 };
    entry.score += weight / (config.search.fusionConstant + i + 1);
    scores.set(row.id, entry);
  });
  add(textRows, config.search.ftsWeight);
  add(semanticRows, config.search.semanticWeight);
  const ranked = [...scores.values()].sort((a,b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  return {
    results: ranked.slice(offset, offset + limit).map(({ row, score }) => resultRow(config, row, score)),
    mode: config.embeddings.enabled && !degraded ? 'hybrid' : 'text', degraded,
    ...(reason ? { reason } : {})
  };
}
