import { saveDocument, getDocument, deleteDocument } from '../core/documents/documents.js';
import { search } from '../core/search/search.js';
import { reindex } from '../core/indexing/reindex.js';
import { getDb } from '../db/sqlite.js';
import { validateToolArgs } from './tool-registry.js';

export function createToolHandlers(config) {
  const operations = {
    mem_save: args => saveDocument(config, args),
    mem_search: args => search(config, args),
    mem_get: args => getDocument(config, args.id),
    mem_delete: args => deleteDocument(config, args.id, args),
    mem_reindex: args => reindex(config, args),
    mem_stats: () => {
      const db = getDb(config);
      return {
        documents: db.prepare('SELECT COUNT(*) AS count FROM documents WHERE deleted_at IS NULL').get().count,
        collections: db.prepare('SELECT collection,COUNT(*) AS count FROM documents WHERE deleted_at IS NULL GROUP BY collection').all(),
        index: { path: config.sqlitePath, deleted: db.prepare('SELECT COUNT(*) AS count FROM documents WHERE deleted_at IS NOT NULL').get().count },
        embeddings: { enabled: config.embeddings.enabled, workerAvailable: !!config.getQueryEmbedding,
          jobs: db.prepare('SELECT status,COUNT(*) AS count FROM embedding_jobs GROUP BY status').all() }
      };
    }
  };
  return Object.fromEntries(Object.entries(operations).map(([name, operation]) => [name, async (args = {}) => {
    try {
      const value = await operation(validateToolArgs(name, args));
      const isError = value.indexed === false || value.errors?.length > 0;
      return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }], isError: true };
    }
  }]));
}
