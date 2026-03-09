import { getDb } from '../../db/sqlite.js';
import { normalizeForFts } from '../indexing/indexer.js';
function getBm25Weights(config) {
  const w = config.indexing?.ftsWeights || {};
  return [
    w.title ?? 10,
    w.topicKey ?? 8,
    1, 1, 1,
    w.heading ?? 5,
    w.body ?? 1
  ];
}

/**
 * Normalize query for FTS5: same as indexed text (NFD, remove diacritics, lowercase).
 * Leaves FTS5 operators (AND, OR, NOT, "phrase") intact.
 */
function normalizeQuery(q) {
  if (q == null || typeof q !== 'string') return '';
  return q.trim();
}

/**
 * @param {object} config - resolved config
 * @param {object} options
 * @param {string} options.query - search query (will be normalized for token match)
 * @param {string} [options.scopeMode] - 'project-only' | 'home-only' | 'merged'
 * @param {string} [options.project] - project name (required for project-only and merged)
 * @param {number} [options.limit] - max results
 * @returns {Array<{ documentId: string, chunkId: string, title: string, topicKey: string, type: string, scope: string, project: string | null, headingPath: string, snippet: string, score: number }>}
 */
function search(config, options = {}) {
  const {
    query,
    scopeMode = config.search?.defaultScopeMode || 'merged',
    project = null,
    limit = config.search?.defaultLimit ?? 10
  } = options;

  if (!query || !String(query).trim()) {
    return [];
  }

  const db = getDb(config);
  const q = normalizeQuery(query);
  const weights = getBm25Weights(config);
  const bm25Args = weights.map((w, i) => (i === 0 ? w : `, ${w}`)).join('');

  let scopeCondition = '';
  const params = [q];

  if (scopeMode === 'project-only') {
    if (!project) return [];
    scopeCondition = ' AND d.scope = ? AND d.project = ? AND d.deleted_at IS NULL';
    params.push('project', project);
  } else if (scopeMode === 'home-only') {
    scopeCondition = ' AND d.scope = ? AND d.deleted_at IS NULL';
    params.push('home');
  } else {
    // merged: project or home; when project given, prefer project
    scopeCondition = ' AND d.deleted_at IS NULL AND (d.scope = ? OR (d.scope = ? AND d.project = ?))';
    params.push('home', 'project', project || '');
  }

  params.push(project || ''); // ORDER BY: project first in merged, else no match
  const ftsLimit = config.embeddings?.enabled ? Math.max(limit * 3, 50) : limit;
  params.push(ftsLimit);

  const sql = `
    SELECT
      f.chunk_id AS chunkId,
      f.document_id AS documentId,
      d.title AS title,
      d.topic_key AS topicKey,
      d.type AS type,
      d.scope AS scope,
      d.project AS project,
      c.heading_path AS headingPath,
      c.content AS content,
      snippet(document_chunks_fts, 0, '<b>', '</b>', '...', 24) AS snippetTitle,
      snippet(document_chunks_fts, 6, '<b>', '</b>', '...', 32) AS snippetBody,
      bm25(document_chunks_fts, ${bm25Args}) AS rank
    FROM document_chunks_fts f
    JOIN documents d ON d.id = f.document_id
    JOIN document_chunks c ON c.id = f.chunk_id
    WHERE document_chunks_fts MATCH ? ${scopeCondition}
    ORDER BY (CASE WHEN d.scope = 'project' AND d.project = ? THEN 0 ELSE 1 END), rank
    LIMIT ?
  `;

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);

  const mapped = rows.map((r) => {
    const snippet = [r.snippetTitle, r.snippetBody].filter(Boolean).join(' … ') || r.content?.slice(0, 200) || '';
    return {
      documentId: r.documentId,
      chunkId: r.chunkId,
      title: r.title,
      topicKey: r.topicKey,
      type: r.type,
      scope: r.scope,
      project: r.project,
      headingPath: r.headingPath,
      snippet: snippet.trim(),
      score: -Number(r.rank), // bm25 returns negative (lower = better), we expose positive
      _rank: r.rank
    };
  });

  if (!config.embeddings?.enabled || mapped.length === 0) {
    return mapped.slice(0, limit).map(({ _rank, ...r }) => r);
  }

  return hybridSearch(config, { query, scopeMode, project, limit, ftsRows: mapped });
}

async function hybridSearch(config, { query, scopeMode, project, limit, ftsRows }) {
  const ftsWeight = config.search?.ftsWeight ?? 0.7;
  const semanticWeight = config.search?.semanticWeight ?? 0.3;
  let embedder;
  let vectorStore;
  try {
    const [{ getEmbedder }, { getVectorStore }] = await Promise.all([
      import('../embeddings/embedder.js'),
      import('../embeddings/vectorStore.js')
    ]);
    embedder = await getEmbedder(config);
    vectorStore = await getVectorStore(config);
  } catch {
    return ftsRows.slice(0, limit).map(({ _rank, ...r }) => r);
  }
  if (!embedder || !vectorStore) {
    return ftsRows.slice(0, limit).map(({ _rank, ...r }) => r);
  }
  let semanticHits;
  try {
    const queryEmbedding = await embedder.embed(query);
    semanticHits = await vectorStore.search(config, queryEmbedding, Math.max(limit * 2, 30));
  } catch {
    return ftsRows.slice(0, limit).map(({ _rank, ...r }) => r);
  }
  const byChunk = new Map(ftsRows.map((r) => [r.chunkId, { ...r }]));
  const ftsScores = ftsRows.map((r) => -Number(r._rank));
  const minFts = Math.min(...ftsScores);
  const maxFts = Math.max(...ftsScores);
  const rangeFts = maxFts - minFts || 1;
  for (const row of ftsRows) {
    const normFts = (minFts === maxFts) ? 1 : ((-Number(row._rank)) - minFts) / rangeFts;
    const sem = semanticHits.find((h) => h.chunk_id === row.chunkId);
    const similarity = sem ? 1 - sem.distance : 0;
    const combined = ftsWeight * normFts + semanticWeight * similarity;
    byChunk.get(row.chunkId).score = combined;
  }
  for (const sem of semanticHits) {
    if (!byChunk.has(sem.chunk_id)) {
      const db = getDb(config);
      const r = db.prepare(`
        SELECT c.id AS chunkId, c.document_id AS documentId, d.title, d.topic_key AS topicKey, d.type, d.scope, d.project, c.heading_path AS headingPath, c.content
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.id = ?
      `).get(sem.chunk_id);
      if (r) {
        const similarity = 1 - sem.distance;
        byChunk.set(sem.chunk_id, {
          documentId: r.documentId,
          chunkId: r.chunkId,
          title: r.title,
          topicKey: r.topicKey,
          type: r.type,
          scope: r.scope,
          project: r.project,
          headingPath: r.headingPath,
          snippet: (r.content || '').slice(0, 200).trim(),
          score: semanticWeight * similarity
        });
      }
    }
  }
  return Array.from(byChunk.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ _rank, ...r }) => r);
}

/**
 * Get recent context without FTS (for mem_context when no query).
 */
function getRecentContext(config, options = {}) {
  const { project = null, limit = config.search?.defaultLimit ?? 10 } = options;
  const db = getDb(config);
  let sql = `
    SELECT c.id AS chunkId, d.id AS documentId, d.title, d.topic_key AS topicKey, d.type, d.scope, d.project, c.heading_path AS headingPath, c.content
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.deleted_at IS NULL
  `;
  const params = [];
  if (project) {
    sql += ' AND (d.scope = ? OR (d.scope = ? AND d.project = ?))';
    params.push('home', 'project', project);
  } else {
    sql += ' AND d.scope = ?';
    params.push('home');
  }
  sql += ' ORDER BY d.updated_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    documentId: r.documentId,
    chunkId: r.chunkId,
    title: r.title,
    topicKey: r.topicKey,
    type: r.type,
    scope: r.scope,
    project: r.project,
    headingPath: r.headingPath,
    snippet: (r.content || '').slice(0, 300).trim()
  }));
}

export { search, getRecentContext, normalizeQuery, getBm25Weights };
