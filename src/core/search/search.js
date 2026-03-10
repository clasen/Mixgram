import { getDb } from '../../db/sqlite.js';
import { normalizeForFts } from '../indexing/indexer.js';

function getBm25Weights(config) {
  const w = config.indexing?.ftsWeights || {};
  return [
    w.title ?? 10,
    w.h1 ?? 8,
    w.h2 ?? 6,
    w.h3 ?? 5,
    w.h4 ?? 4,
    w.h5 ?? 3,
    w.h6 ?? 2,
    w.body ?? 1
  ];
}

// FTS5 uses "/" for NEAR (e.g. term/5) and "-" for NOT; dash-like chars between words break parsing.
const FTS5_NEAR_SLASH = /\//g;
const FTS5_NOT_HYPHEN = /(?<=\w)[-\u2010-\u2015\u2212](?=\w)/g; // hyphen, en/em-dash, minus

/**
 * Normalize query for FTS5: same as indexed text (NFD, remove diacritics, lowercase).
 * Replaces "/" with space so it is not interpreted as FTS5 NEAR syntax (e.g. term/5).
 * Replaces "-" (and Unicode dashes) between word chars with space so "alchemy-tycoon" is not parsed as "alchemy" NOT "tycoon".
 * Leaves FTS5 operators (AND, OR, NOT, "phrase") intact.
 */
function normalizeQuery(q) {
  if (q == null || typeof q !== 'string') return '';
  const trimmed = q.trim();
  const slashSafe = trimmed.replace(FTS5_NEAR_SLASH, ' ');
  const hyphenSafe = slashSafe.replace(FTS5_NOT_HYPHEN, ' ');
  return normalizeForFts(hyphenSafe);
}

/**
 * @param {object} config - resolved config
 * @param {object} options
 * @param {string} options.query - search query (will be normalized for token match)
 * @param {string} [options.scopeMode] - 'project-only' | 'home-only' | 'merged'
 * @param {string} [options.project] - project name (required for project-only and merged)
 * @param {number} [options.limit] - max results
 * @returns {Array<{ documentId: string, title: string, topicKey: string, type: string, scope: string, project: string | null, snippet: string, score: number }>}
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
    scopeCondition = ' AND d.deleted_at IS NULL AND (d.scope = ? OR (d.scope = ? AND d.project = ?))';
    params.push('home', 'project', project || '');
  }

  params.push(project || '');
  params.push(limit);

  const sql = `
    SELECT
      f.document_id AS documentId,
      d.title AS title,
      d.topic_key AS topicKey,
      d.type AS type,
      d.scope AS scope,
      d.project AS project,
      d.body AS body,
      snippet(document_fts, 1, '<b>', '</b>', '...', 24) AS snippetTitle,
      snippet(document_fts, 8, '<b>', '</b>', '...', 64) AS snippetBody,
      bm25(document_fts, ${bm25Args}) AS rank
    FROM document_fts f
    JOIN documents d ON d.id = f.document_id
    WHERE document_fts MATCH ? ${scopeCondition}
    ORDER BY (CASE WHEN d.scope = 'project' AND d.project = ? THEN 0 ELSE 1 END), rank
    LIMIT ?
  `;

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);

  return rows.map((r) => {
    const fromFts = [r.snippetTitle, r.snippetBody].filter((x) => x != null && x !== '').join(' … ');
    const fallback = r.body != null ? String(r.body).slice(0, 200) : '';
    const snippet = (fromFts && fromFts.trim()) || fallback || '';
    return {
      documentId: r.documentId,
      title: r.title,
      topicKey: r.topicKey,
      type: r.type,
      scope: r.scope,
      project: r.project,
      snippet: String(snippet).trim(),
      score: -Number(r.rank)
    };
  });
}

/**
 * Get recent context without FTS (for mem_context when no query).
 */
function getRecentContext(config, options = {}) {
  const { project = null, limit = config.search?.defaultLimit ?? 10 } = options;
  const db = getDb(config);
  let sql = `
    SELECT d.id AS documentId, d.title, d.topic_key AS topicKey, d.type, d.scope, d.project, d.body
    FROM documents d
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
    title: r.title,
    topicKey: r.topicKey,
    type: r.type,
    scope: r.scope,
    project: r.project,
    snippet: (r.body || '').slice(0, 300).trim()
  }));
}

export { search, getRecentContext, normalizeQuery, getBm25Weights };
