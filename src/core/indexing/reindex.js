import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { getDb } from '../../db/sqlite.js';
import { enqueueDocuments } from '../embeddings/queue.js';
import { contentHash } from '../../utils/hash.js';
import { indexDocument, removeDocumentFromIndex } from './indexer.js';

function listMarkdownPaths(config) {
  return Object.values(config.collections).flatMap(root => fs.existsSync(root)
    ? globSync('**/*.md', { cwd: root, nodir: true, follow: false }).map(p => path.resolve(root, p)) : []);
}

export function reindex(config, { full = false } = {}) {
  const paths = listMarkdownPaths(config);
  const db = getDb(config);
  const result = { scanned: paths.length, indexed: 0, skipped: 0, removed: 0, errors: [] };
  db.transaction(() => {
    if (full) {
      db.exec('DELETE FROM document_fts; DELETE FROM embedding_jobs; DELETE FROM documents;');
    }
    for (const filePath of paths) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const stored = db.prepare('SELECT content_hash FROM documents WHERE path = ?').get(filePath);
        if (!full && stored?.content_hash === contentHash(raw)) { result.skipped++; continue; }
        indexDocument(config, filePath, raw);
        result.indexed++;
      } catch (error) {
        result.errors.push({ path: filePath, error: error.message });
      }
    }
    if (config.embeddings.enabled) {
      enqueueDocuments(config, db.prepare('SELECT id FROM documents WHERE deleted_at IS NULL').all().map(row => row.id));
    }
    const present = new Set(paths);
    for (const row of db.prepare('SELECT id,path FROM documents').all()) {
      if (!present.has(row.path)) { removeDocumentFromIndex(config, row.id); result.removed++; }
    }
  })();
  return result;
}
