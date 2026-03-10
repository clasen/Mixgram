#!/usr/bin/env node
/**
 * Benchmark: indexing and reindexing with synthetic corpus.
 * Breaks down timings (clear, listPaths, indexing) and compares with/without embeddings.
 * Opt-in; not run by npm test.
 *
 * Usage:
 *   npm run bench:indexing   # indexing only
 *   npm run bench:embed      # indexing + embedding queue processing (slow)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import {
  fullReindex,
  incrementalReindex,
  clearIndex,
  listMarkdownPaths
} from '../src/core/indexing/reindex.js';
import { indexDocument } from '../src/core/indexing/indexer.js';
import { processNextJob } from '../src/core/embeddings/queue.js';
import { closeDb, getDb } from '../src/db/sqlite.js';
import { toMarkdown } from '../src/utils/markdown.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-bench-'));
const baseConfig = loadConfig({
  homeMemoryRoot: path.join(tmpDir, 'home'),
  projectMemoryRoot: path.join(tmpDir, 'docs'),
  sqlitePath: path.join(tmpDir, 'index.db')
});
fs.mkdirSync(path.dirname(baseConfig.sqlitePath), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'docs', 'generated'), { recursive: true });

const configNoEmb = {
  ...baseConfig,
  embeddings: { ...baseConfig.embeddings, enabled: false }
};
const configEmb = {
  ...baseConfig,
  embeddings: { ...baseConfig.embeddings, enabled: true }
};

/** Frontmatter with same keys the app writes so the indexer parses the same. */
function writeDoc(dir, id, title, body) {
  const now = new Date().toISOString();
  const frontmatter = {
    id,
    title,
    type: 'generated_note',
    scope: 'project',
    project: 'bench',
    topic_key: `bench/${id}`,
    created_at: now
  };
  const raw = toMarkdown(frontmatter, body);
  const filePath = path.join(dir, 'generated', `${id}.md`);
  fs.writeFileSync(filePath, raw, 'utf8');
  return filePath;
}

function buildLargeBody(size) {
  const intro = '# Big\n\nNeedleInHaystack\n\n';
  const filler = 'x'.repeat(Math.max(0, size - intro.length));
  return intro + filler;
}

const NUM_SMALL = 3;
const LARGE_SIZE = 8_000;
const RUN_EMBED_PROCESSING = process.argv.includes('--embed');

console.log('Corpus: %d small .md + 1 large .md (~%d chars)', NUM_SMALL, LARGE_SIZE);
console.log('Mode: %s\n', RUN_EMBED_PROCESSING ? 'indexing + embedding queue processing' : 'indexing only');

// --- Create corpus ---
for (let i = 0; i < NUM_SMALL; i++) {
  writeDoc(baseConfig.projectMemoryRoot, `obs_small_${i}`, `Small ${i}`, `Content for small doc ${i}.\n`);
}
const largePath = writeDoc(baseConfig.projectMemoryRoot, 'obs_large', 'Large doc', buildLargeBody(LARGE_SIZE));

/**
 * Full reindex with breakdown: clearIndex, listMarkdownPaths, index loop.
 * @returns {{ total: number, clear: number, list: number, indexLoop: number, indexed: number }}
 */
function fullReindexWithBreakdown(config) {
  let t0, t1;
  t0 = performance.now();
  clearIndex(config);
  t1 = performance.now();
  const clearMs = t1 - t0;

  t0 = performance.now();
  const paths = listMarkdownPaths(config);
  t1 = performance.now();
  const listMs = t1 - t0;

  let indexed = 0;
  t0 = performance.now();
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      indexDocument(config, filePath, raw, stat.mtimeMs);
      indexed++;
    } catch (_) {}
  }
  t1 = performance.now();
  const indexLoopMs = t1 - t0;
  const totalMs = clearMs + listMs + indexLoopMs;

  return { total: totalMs, clear: clearMs, list: listMs, indexLoop: indexLoopMs, indexed };
}

function ms(n) {
  return Math.round(n);
}

function section(title) {
  console.log('\n--- %s ---', title);
}

async function runBenchmark() {
  // ========== Without embeddings ==========
  section('Without embeddings');

  let b = fullReindexWithBreakdown(configNoEmb);
  console.log('fullReindex:     %d ms  (clear %d ms, list %d ms, indexing %d ms, docs=%d)',
    ms(b.total), ms(b.clear), ms(b.list), ms(b.indexLoop), b.indexed);

  let t0 = performance.now();
  const inc0 = incrementalReindex(configNoEmb);
  let t1 = performance.now();
  console.log('incremental (0 changes): %d ms  → scanned=%d skipped=%d indexed=%d removed=%d',
    ms(t1 - t0), inc0.scanned, inc0.skipped, inc0.indexed, inc0.removed);

  fs.appendFileSync(largePath, '\n\nAppended line.');

  t0 = performance.now();
  const inc1 = incrementalReindex(configNoEmb);
  t1 = performance.now();
  console.log('incremental (1 file changed): %d ms  → scanned=%d skipped=%d indexed=%d removed=%d',
    ms(t1 - t0), inc1.scanned, inc1.skipped, inc1.indexed, inc1.removed);

  // Final state without embeddings
  const db = getDb(baseConfig);
  const docsCount = db.prepare('SELECT COUNT(*) AS c FROM documents').get()?.c ?? 0;
  const ftsCount = db.prepare('SELECT COUNT(*) AS c FROM document_fts').get()?.c ?? 0;
  console.log('State: %d documents, %d FTS rows.', docsCount, ftsCount);

  // ========== With embeddings (indexing + queue) ==========
  section('With embeddings (indexing + queue)');

  clearIndex(configEmb);
  b = fullReindexWithBreakdown(configEmb);
  // Allow enqueue promises to settle
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const jobsEnqueued = db.prepare('SELECT COUNT(*) AS c FROM embedding_jobs').get()?.c ?? 0;
  console.log('fullReindex:     %d ms  (clear %d ms, list %d ms, indexing %d ms, docs=%d)',
    ms(b.total), ms(b.clear), ms(b.list), ms(b.indexLoop), b.indexed);
  console.log('Jobs in queue:   %d', jobsEnqueued);

  t0 = performance.now();
  const inc0emb = incrementalReindex(configEmb);
  t1 = performance.now();
  console.log('incremental (0 changes): %d ms  → scanned=%d skipped=%d indexed=%d removed=%d',
    ms(t1 - t0), inc0emb.scanned, inc0emb.skipped, inc0emb.indexed, inc0emb.removed);

  fs.appendFileSync(largePath, '\n\nAnother line.');

  t0 = performance.now();
  const inc1emb = incrementalReindex(configEmb);
  t1 = performance.now();
  console.log('incremental (1 file changed): %d ms  → scanned=%d skipped=%d indexed=%d removed=%d',
    ms(t1 - t0), inc1emb.scanned, inc1emb.skipped, inc1emb.indexed, inc1emb.removed);

  // ========== Embedding processing (optional) ==========
  if (RUN_EMBED_PROCESSING && configEmb.embeddings?.enabled) {
    section('Embedding processing (queue → model → vector store)');

    const pendingBefore = db.prepare("SELECT COUNT(*) AS c FROM embedding_jobs WHERE status = 'pending'").get()?.c ?? 0;
    t0 = performance.now();
    let processed = 0;
    while (await processNextJob(configEmb)) {
      processed++;
    }
    t1 = performance.now();
    console.log('Process queue:   %d ms  (jobs processed=%d, pending before=%d)',
      ms(t1 - t0), processed, pendingBefore);
  }

  // Final summary
  section('Summary');
  const docsFinal = db.prepare('SELECT COUNT(*) AS c FROM documents').get()?.c ?? 0;
  const ftsFinal = db.prepare('SELECT COUNT(*) AS c FROM document_fts').get()?.c ?? 0;
  const jobsFinal = db.prepare('SELECT status, COUNT(*) AS c FROM embedding_jobs GROUP BY status').all();
  console.log('Documents: %d, FTS rows: %d', docsFinal, ftsFinal);
  if (jobsFinal.length) {
    console.log('Embedding jobs: %s', jobsFinal.map((r) => `${r.status}=${r.c}`).join(', '));
  }
}

runBenchmark()
  .then(() => {
    closeDb();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
    console.log('\nDone.\n');
  })
  .catch((err) => {
    closeDb();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
    console.error(err);
    process.exit(1);
  });
