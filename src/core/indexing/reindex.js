import path from 'path';
import fs from 'fs';
import { globSync } from 'glob';
import { getDb } from '../../db/sqlite.js';
import { indexDocument, removeDocumentFromIndex } from './indexer.js';

/**
 * List all Markdown file paths under home (cross-project) and project memory root (repo-local).
 */
function listMarkdownPaths(config) {
  const homeRoot = config.homeMemoryRoot;
  const projectRoot = config.projectMemoryRoot;
  const out = [];
  if (fs.existsSync(homeRoot)) {
    const homeFiles = globSync('**/*.md', { cwd: homeRoot });
    out.push(...homeFiles.map((p) => path.join(homeRoot, p)));
  }
  if (projectRoot && fs.existsSync(projectRoot)) {
    const projectFiles = globSync('**/*.md', { cwd: projectRoot });
    out.push(...projectFiles.map((p) => path.join(projectRoot, p)));
  }
  return out;
}

/**
 * Clear entire text index (documents, chunks, tags, FTS). Use before full rebuild.
 */
function clearIndex(config) {
  const db = getDb(config);
  db.transaction(() => {
    const ftsRowids = db.prepare('SELECT rowid FROM document_chunks_fts').all();
    for (const { rowid } of ftsRowids) {
      db.prepare('DELETE FROM document_chunks_fts WHERE rowid = ?').run(rowid);
    }
    db.prepare('DELETE FROM document_chunks').run();
    db.prepare('DELETE FROM document_tags').run();
    db.prepare('DELETE FROM documents').run();
  })();
}

/**
 * Full reindex: clear index then index every .md file under home and projects.
 * Use for rebuild-from-scratch (e.g. after deleting SQLite).
 */
function fullReindex(config) {
  clearIndex(config);
  const paths = listMarkdownPaths(config);
  let indexed = 0;
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      indexDocument(config, filePath, raw, stat.mtimeMs);
      indexed++;
    } catch (err) {
      // skip invalid or unreadable files
    }
  }
  return { indexed, total: paths.length };
}

/**
 * Incremental reindex: index all found .md files, then remove from index any document
 * whose path is no longer present on disk (manual delete). Does not clear the index first.
 */
function incrementalReindex(config) {
  const paths = listMarkdownPaths(config);
  const pathsSet = new Set(paths.map((p) => path.normalize(p)));
  let indexed = 0;
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      indexDocument(config, filePath, raw, stat.mtimeMs);
      indexed++;
    } catch (_) {}
  }
  const db = getDb(config);
  const allDocs = db.prepare('SELECT id, path FROM documents').all();
  let removed = 0;
  for (const row of allDocs) {
    const norm = path.normalize(row.path);
    if (!pathsSet.has(norm)) {
      removeDocumentFromIndex(config, row.id);
      removed++;
    }
  }
  return { indexed, removed, totalPaths: paths.length };
}

/**
 * Get document id by file path (for watcher on delete).
 */
function getDocumentIdByPath(config, filePath) {
  const db = getDb(config);
  const norm = path.normalize(filePath);
  const row = db.prepare('SELECT id FROM documents WHERE path = ?').get(norm);
  return row?.id ?? null;
}

export { listMarkdownPaths, clearIndex, fullReindex, incrementalReindex, getDocumentIdByPath };
