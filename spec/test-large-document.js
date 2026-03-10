#!/usr/bin/env node
/**
 * Test: indexar un documento de ~100k caracteres y verificar que queda indexado y es buscable.
 * Se ejecuta con la suite (npm test) o en solitario: node spec/test-large-document.js
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import { indexDocument } from '../src/core/indexing/indexer.js';
import { search } from '../src/core/search/search.js';
import { getDb, closeDb } from '../src/db/sqlite.js';
import { toMarkdown } from '../src/utils/markdown.js';

const TARGET_SIZE = 100_000;
const NEEDLE = 'NeedleInHaystack100k';

function buildLargeBody(targetSize) {
  const intro = `# Documento grande\n\nPárrafo inicial. ${NEEDLE} aquí.\n\n`;
  const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20) + '\n\n';
  const repeat = Math.ceil((targetSize - intro.length) / paragraph.length);
  return intro + paragraph.repeat(Math.max(0, repeat));
}

/**
 * @param {object} config - resolved config (e.g. from run-tests)
 * @returns {{ passed: number, failed: number }}
 */
export function runLargeDocumentTest(config) {
  let passed = 0;
  let failed = 0;
  const ok = (cond, msg) => {
    if (cond) passed++;
    else failed++;
    if (!cond) console.error('FAIL:', msg);
  };

  const docsDir = path.join(config.projectMemoryRoot, 'generated');
  fs.mkdirSync(docsDir, { recursive: true });

  const body = buildLargeBody(TARGET_SIZE);
  const id = 'large100k00';
  const now = new Date().toISOString();
  const frontmatter = {
    id,
    title: 'Documento 100k',
    type: 'generated_note',
    scope: 'project',
    project: 'test',
    topic_key: 'test/large-100k',
    created_at: now
  };
  const raw = toMarkdown(frontmatter, body);
  const docPath = path.join(docsDir, 'large-100k.md');
  fs.writeFileSync(docPath, raw, 'utf8');
  const stat = fs.statSync(docPath);

  const size = raw.length;
  ok(size >= TARGET_SIZE * 0.95, `documento ~100k (${size} chars)`);

  indexDocument(config, docPath, raw, stat.mtimeMs, { overrideFrontmatter: frontmatter });

  const db = getDb(config);
  const doc = db.prepare('SELECT id, length(body) AS body_len FROM documents WHERE id = ?').get(id);
  ok(!!doc, 'documento en tabla documents');
  ok(doc.body_len >= TARGET_SIZE * 0.9, `body en DB ~100k (${doc?.body_len ?? 0} chars)`);

  const ftsRow = db.prepare('SELECT document_id, length(body) AS body_len FROM document_fts WHERE document_id = ?').get(id);
  ok(!!ftsRow, 'documento en FTS');
  ok((ftsRow?.body_len ?? 0) >= TARGET_SIZE * 0.9, `body en FTS ~100k (${ftsRow?.body_len ?? 0} chars)`);

  const results = search(config, { query: NEEDLE, project: 'test', limit: 5 });
  ok(results.length >= 1, 'búsqueda encuentra el documento');
  ok(results.some((r) => r.documentId === id), 'resultado es el doc 100k');
  ok(results[0].snippet != null && results[0].snippet.length > 0, 'snippet no vacío');

  return { passed, failed };
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-large-doc-'));
  const config = loadConfig({
    homeMemoryRoot: path.join(tmpDir, 'home'),
    projectMemoryRoot: path.join(tmpDir, 'docs'),
    sqlitePath: path.join(tmpDir, 'index.db')
  });
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });

  const { passed, failed } = runLargeDocumentTest(config);
  console.log(`Large document test: ${passed} passed, ${failed} failed`);
  closeDb();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = failed > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith('test-large-document.js')) {
  main();
}
