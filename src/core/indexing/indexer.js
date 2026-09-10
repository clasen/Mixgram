import fs from 'fs';
import path from 'path';
import { getDb } from '../../db/sqlite.js';
import { parse } from '../../utils/markdown.js';
import { extractMarkdownFields } from './parser.js';
import { contentHash } from '../../utils/hash.js';
import { collectionForPath } from '../../fs/paths.js';
import { enqueueDocuments } from '../embeddings/queue.js';

export function normalizeForFts(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function readDocument(config, filePath, raw = fs.readFileSync(filePath, 'utf8')) {
  const { frontmatter, body } = parse(raw);
  const collection = collectionForPath(config, filePath);
  const stat = fs.statSync(filePath);
  const fields = extractMarkdownFields(body, config.indexing);
  const created = frontmatter.created_at ?? stat.birthtime.toISOString();
  return {
    metadata: {
      id: frontmatter.id ?? contentHash(path.resolve(filePath)).slice(0, 32),
      title: frontmatter.title ?? fields.title ?? '',
      type: frontmatter.type ?? 'note',
      key: frontmatter.key ?? null,
      tags: [...new Set(frontmatter.tags ?? [])],
      created_at: created,
      updated_at: frontmatter.updated_at ?? stat.mtime.toISOString(),
      deleted_at: frontmatter.deleted_at ?? null
    },
    collection, body, fields, raw, mtime: stat.mtimeMs, path: path.resolve(filePath)
  };
}

export function indexDocument(config, filePath, raw) {
  const doc = readDocument(config, filePath, raw);
  const db = getDb(config);
  const m = doc.metadata;
  const hash = contentHash(doc.raw);
  db.transaction(() => {
    const existing = db.prepare('SELECT path FROM documents WHERE id = ?').get(m.id);
    if (existing && existing.path !== doc.path && fs.existsSync(existing.path)) throw new Error(`Duplicate document id: ${m.id}`);
    const byPath = db.prepare('SELECT id FROM documents WHERE path = ?').get(doc.path);
    if (byPath && byPath.id !== m.id) removeDocumentFromIndex(config, byPath.id);
    db.prepare(`INSERT INTO documents (id,path,collection,title,type,key,tags,created_at,updated_at,deleted_at,content_hash,file_mtime_ms,body)
      VALUES (@id,@path,@collection,@title,@type,@key,@tags,@created_at,@updated_at,@deleted_at,@content_hash,@file_mtime_ms,@body)
      ON CONFLICT(id) DO UPDATE SET path=excluded.path,collection=excluded.collection,title=excluded.title,type=excluded.type,
      key=excluded.key,tags=excluded.tags,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
      content_hash=excluded.content_hash,file_mtime_ms=excluded.file_mtime_ms,body=excluded.body`).run({
      ...m, tags: JSON.stringify(m.tags), path: doc.path, collection: doc.collection, content_hash: hash, file_mtime_ms: doc.mtime, body: doc.body
    });
    db.prepare('DELETE FROM document_fts WHERE document_id = ?').run(m.id);
    if (!m.deleted_at) {
      const fields = [m.title, ...['h1','h2','h3','h4','h5','h6','body'].map(k => doc.fields[k])].map(normalizeForFts);
      db.prepare('INSERT INTO document_fts VALUES (?,?,?,?,?,?,?,?,?)').run(m.id, ...fields);
      enqueueDocuments(config, [m.id]);
    } else {
      db.prepare('DELETE FROM embedding_jobs WHERE document_id = ?').run(m.id);
    }
  })();
  return { id: m.id };
}

export function removeDocumentFromIndex(config, id) {
  const db = getDb(config);
  db.transaction(() => {
    db.prepare('DELETE FROM document_fts WHERE document_id = ?').run(id);
    db.prepare('DELETE FROM embedding_jobs WHERE document_id = ?').run(id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  })();
}
