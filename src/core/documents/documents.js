import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { documentPath } from '../../fs/paths.js';
import { toMarkdown } from '../../utils/markdown.js';
import { readDocument, indexDocument, removeDocumentFromIndex } from '../indexing/indexer.js';
import { getDb } from '../../db/sqlite.js';

function resolveDocument(config, id, includeDeleted = false) {
  const row = getDb(config).prepare('SELECT path FROM documents WHERE id = ?').get(id);
  if (!row) throw new Error('Document not found');
  const doc = readDocument(config, row.path);
  if (doc.metadata.id !== id) throw new Error('Document identity changed; reindex required');
  if (!includeDeleted && doc.metadata.deleted_at) throw new Error('Document not found');
  return doc;
}

function persist(config, doc, created) {
  fs.mkdirSync(path.dirname(doc.path), { recursive: true });
  const temp = `${doc.path}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, toMarkdown(doc.metadata, doc.body), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, doc.path);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  const result = { id: doc.metadata.id, path: doc.path, created, saved: true, indexed: true };
  try { indexDocument(config, doc.path); }
  catch (error) { result.indexed = false; result.error = error.message; }
  return result;
}

export function saveDocument(config, payload) {
  const db = getDb(config);
  const collection = payload.collection ?? config.defaultCollection;
  if (!Object.hasOwn(config.collections, collection)) throw new Error('Unknown collection');
  const row = !payload.id && payload.key ? db.prepare('SELECT id FROM documents WHERE collection = ? AND key = ? AND deleted_at IS NULL').get(collection, payload.key) : null;
  const id = payload.id ?? row?.id;
  const existing = id ? resolveDocument(config, id) : null;
  if (existing && payload.collection && payload.collection !== existing.collection) throw new Error('Move the file between collection folders and reindex to change collection');
  const now = new Date().toISOString();
  const metadata = existing ? { ...existing.metadata } : {
    id: randomUUID(), title: '', type: 'note', key: null, tags: [], created_at: now, deleted_at: null
  };
  for (const key of ['title', 'type', 'key', 'tags']) {
    if (payload[key] !== undefined) metadata[key] = payload[key];
  }
  metadata.tags = [...new Set(metadata.tags)];
  metadata.updated_at = now;
  const actualCollection = existing?.collection ?? collection;
  if (metadata.key) {
    const conflict = db.prepare('SELECT id FROM documents WHERE collection = ? AND key = ? AND id != ? AND deleted_at IS NULL').get(actualCollection, metadata.key, metadata.id);
    if (conflict) throw new Error('Key already belongs to another document in this collection');
  }
  const doc = { metadata, body: payload.content ?? existing?.body ?? '',
    path: existing?.path ?? documentPath(config, { collection: actualCollection, ...metadata }) };
  if (!existing && fs.existsSync(doc.path)) throw new Error('Document path already exists');
  return persist(config, doc, !existing);
}

export function getDocument(config, id) {
  const doc = resolveDocument(config, id);
  return { ...doc.metadata, collection: doc.collection, content: doc.body };
}

export function deleteDocument(config, id, { hardDelete = false } = {}) {
  const doc = resolveDocument(config, id, true);
  if (hardDelete) {
    fs.unlinkSync(doc.path);
    try { removeDocumentFromIndex(config, id); }
    catch (error) { return { id, deleted: true, indexed: false, error: error.message }; }
    return { id, deleted: true, indexed: true };
  }
  const now = new Date().toISOString();
  doc.metadata.deleted_at = now;
  doc.metadata.updated_at = now;
  return { ...persist(config, doc, false), deleted: true };
}
