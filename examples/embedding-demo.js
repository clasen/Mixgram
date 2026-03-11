#!/usr/bin/env node
/**
 * Example: indexing + search showing embedding effectiveness.
 *
 * Concept:
 * - FTS (full-text search) only matches when query words appear in the document.
 * - Semantic search (embeddings) matches by meaning: different wording, same idea.
 * This script indexes a few documents, then runs the same query with FTS (no match)
 * and with vector search (finds the relevant doc by similarity).
 *
 * Steps:
 * 1. Index several short documents with related content but different wording.
 * 2. Process the embedding queue so each document gets a vector.
 * 3. Compare FTS (text-only) vs semantic (vector) search.
 *
 * Requires: npm install (includes @huggingface/transformers and sqlite-vec).
 * Usage: node examples/embedding-demo.js
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import { saveDocument } from '../src/core/documents/documents.js';
import { search as searchFts } from '../src/core/search/search.js';
import { processNextJob } from '../src/core/embeddings/queue.js';
import { getEmbedder } from '../src/core/embeddings/embedder.js';
import { getDb, closeDb } from '../src/db/sqlite.js';

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-embedding-demo-'));
  const projectRoot = path.join(tmpDir, 'repo');
  const docsDir = path.join(projectRoot, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  const overrides = {
    homeMemoryRoot: path.join(tmpDir, 'home'),
    projectMemoryRoot: path.join(projectRoot, 'docs'),
    sqlitePath: path.join(tmpDir, 'index.db'),
    watch: false,
    indexing: { reindexOnStartup: false },
    embeddings: {
      enabled: true,
      similarityThreshold: 0.80 // more permissive so the demo shows more results
    }
  };

  const config = loadConfig(overrides, tmpDir, projectRoot);
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  fs.mkdirSync(config.homeMemoryRoot, { recursive: true });

  const db = getDb(config);

  console.log('--- 1. Indexing: save documents ---\n');

  const docs = [
    {
      title: 'Memory in Markdown',
      type: 'decision',
      content: 'We store the agent\'s memory in Markdown files under docs/. That way the documentation is visible and editable by hand.'
    },
    {
      title: 'Derived index',
      type: 'decision',
      content: 'The search index is derived from the Markdown files using SQLite FTS5. There is no database as source of truth other than the .md files.'
    },
    {
      title: 'Session persistence',
      type: 'decision',
      content: 'Persist the session context across agent restarts. The important state lives in the memory documents.'
    }
  ];

  for (const d of docs) {
    const out = saveDocument(config, {
      title: d.title,
      type: d.type,
      scope: 'project',
      project: 'demo',
      content: d.content
    });
    console.log(`  Saved: ${d.title} → ${out.id}`);
  }

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  console.log('\n--- 2. Process embedding queue ---\n');
  let processed = 0;
  while (await processNextJob(config)) processed++;
  console.log(`  Jobs processed: ${processed}`);

  const cacheTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_cache_%'").get()?.name;
  const vecCount = cacheTable ? db.prepare(`SELECT COUNT(*) AS c FROM ${cacheTable}`).get()?.c ?? 0 : 0;
  console.log(`  Vectors in index: ${vecCount}\n`);

  console.log('--- 3. FTS search (text only) ---\n');

  const queryLiteral = 'Markdown';
  const ftsResults = searchFts(config, { query: queryLiteral, project: 'demo', limit: 5 });
  console.log(`  Query: "${queryLiteral}"`);
  ftsResults.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.title}] score=${r.score.toFixed(2)} — ${r.snippet.slice(0, 60)}...`);
  });

  const querySemantic = 'where is the agent memory stored';
  const ftsSemantic = searchFts(config, { query: querySemantic, project: 'demo', limit: 5 });
  console.log(`\n  Query: "${querySemantic}"`);
  if (ftsSemantic.length === 0) {
    console.log('  (FTS finds no literal match; these words are not in the documents.)');
  } else {
    ftsSemantic.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.title}] — ${r.snippet.slice(0, 60)}...`);
    });
  }

  console.log('\n--- 4. Semantic search (embeddings) ---\n');

  const embedder = await getEmbedder(config);
  const { getVectorStore } = await import('../src/core/embeddings/vectorStore.js');
  const vectorStore = await getVectorStore(config);

  if (!embedder || !vectorStore) {
    console.log('  Embeddings not available (missing @huggingface/transformers or sqlite-vec).');
    return;
  }

  const queryVec = await embedder.embed(querySemantic);
  const vectorResults = await vectorStore.search(config, queryVec, 10, { similarityThreshold: 0.80 });

  console.log(`  Query: "${querySemantic}"`);
  console.log('  Results by semantic similarity:\n');

  for (const v of vectorResults) {
    const row = db.prepare('SELECT id, title, body FROM documents WHERE id = ?').get(v.document_id);
    const similarity = (1 - v.distance).toFixed(3);
    const snippet = (row?.body || '').slice(0, 80);
    console.log(`  - [${row?.title ?? v.document_id}] similarity=${similarity}`);
    console.log(`    ${snippet}...`);
  }

  console.log('\n--- Summary ---');
  console.log('FTS only finds when the query words appear in the text.');
  console.log('Embedding search finds documents that share the same meaning even without shared words.\n');

  closeDb();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
