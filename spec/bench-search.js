#!/usr/bin/env node
/**
 * Benchmark: search (FTS and optional semantic) over synthetic corpus.
 * Compares short vs long documents, FTS-only vs with embeddings.
 * Opt-in; not run by npm test.
 *
 * Usage:
 *   npm run bench:search        # FTS only
 *   npm run bench:search:embed   # FTS + semantic search (needs embed model)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import { fullReindex, clearIndex, listMarkdownPaths } from '../src/core/indexing/reindex.js';
import { indexDocument } from '../src/core/indexing/indexer.js';
import { processNextJob } from '../src/core/embeddings/queue.js';
import { search as searchFts, getRecentContext } from '../src/core/search/search.js';
import { closeDb, getDb } from '../src/db/sqlite.js';
import { toMarkdown } from '../src/utils/markdown.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-bench-search-'));
const baseConfig = loadConfig({
  homeMemoryRoot: path.join(tmpDir, 'home'),
  projectMemoryRoot: path.join(tmpDir, 'docs'),
  sqlitePath: path.join(tmpDir, 'index.db')
});
fs.mkdirSync(path.dirname(baseConfig.sqlitePath), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'docs', 'generated'), { recursive: true });

const configNoEmb = { ...baseConfig, embeddings: { ...baseConfig.embeddings, enabled: false } };
const configEmb = { ...baseConfig, embeddings: { ...baseConfig.embeddings, enabled: true } };

const RUN_SEMANTIC = process.argv.includes('--embed');

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

function buildLargeBody(size, needle = 'NeedleInHaystack') {
  const intro = `# Big\n\n${needle}\n\n`;
  const filler = 'x'.repeat(Math.max(0, size - intro.length));
  return intro + filler;
}

const NUM_SMALL = 5;
const LARGE_SIZE = 10_000;
const WARMUP = 2;
const RUNS = 5;

function ms(n) {
  return Math.round(n);
}

function section(title) {
  console.log('\n--- %s ---', title);
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Time a sync function over multiple runs; report median ms.
 */
function timeSync(fn, runs = RUNS, warmup = WARMUP) {
  for (let i = 0; i < warmup; i++) fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return median(times);
}

/**
 * Time an async function over multiple runs; report median ms.
 */
async function timeAsync(fn, runs = RUNS, warmup = WARMUP) {
  for (let i = 0; i < warmup; i++) await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  return median(times);
}

async function runBenchmark() {
  console.log('Corpus: %d short .md + 1 large .md (~%d chars). Mode: %s\n', NUM_SMALL, LARGE_SIZE, RUN_SEMANTIC ? 'FTS + semantic' : 'FTS only');

  // --- Corpus: short docs + one large doc with needle ---
  for (let i = 0; i < NUM_SMALL; i++) {
    writeDoc(baseConfig.projectMemoryRoot, `short_${i}`, `Short ${i}`, `Content for short doc ${i}. Some terms: alpha beta gamma.\n`);
  }
  writeDoc(baseConfig.projectMemoryRoot, 'large', 'Large doc', buildLargeBody(LARGE_SIZE));

  fullReindex(configNoEmb);
  const db = getDb(baseConfig);
  const docCount = db.prepare('SELECT COUNT(*) AS c FROM documents').get()?.c ?? 0;
  console.log('Indexed %d documents (FTS only).\n', docCount);

  // ========== FTS search ==========
  section('FTS search (no embeddings)');

  const ftsShort = timeSync(() => {
    searchFts(configNoEmb, { query: 'Content', limit: 10 });
  });
  console.log('Query "Content" (short, matches short docs):  median %d ms', ms(ftsShort));

  const ftsNeedle = timeSync(() => {
    searchFts(configNoEmb, { query: 'NeedleInHaystack', limit: 10 });
  });
  console.log('Query "NeedleInHaystack" (needle in large):   median %d ms', ms(ftsNeedle));

  const ftsPhrase = timeSync(() => {
    searchFts(configNoEmb, { query: 'alpha beta gamma', limit: 10 });
  });
  console.log('Query "alpha beta gamma" (phrase in short):   median %d ms', ms(ftsPhrase));

  const ftsRecent = timeSync(() => {
    getRecentContext(configNoEmb, { limit: 10 });
  });
  console.log('getRecentContext(limit=10):                  median %d ms', ms(ftsRecent));

  // ========== Semantic search (optional) ==========
  if (RUN_SEMANTIC) {
    section('With embeddings: index + process queue');

    clearIndex(configEmb);
    const paths = listMarkdownPaths(configEmb);
    for (const filePath of paths) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const stat = fs.statSync(filePath);
        indexDocument(configEmb, filePath, raw, stat.mtimeMs);
      } catch (_) {}
    }
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    let processed = 0;
    while (await processNextJob(configEmb)) processed++;
    const vecCount = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name LIKE 'vec_%'").get()?.c ?? 0;
    const cacheTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_cache_%'").get()?.name;
    const vecRows = cacheTable ? db.prepare(`SELECT COUNT(*) AS c FROM ${cacheTable}`).get()?.c ?? 0 : 0;
    console.log('Embedding jobs processed: %d. Vector rows: %d.', processed, vecRows);

    section('Semantic search (query embed + vector KNN)');

    const { getEmbedder } = await import('../src/core/embeddings/embedder.js');
    const { search: searchVector } = await import('../src/core/embeddings/vectorStore.js');
    const embedder = await getEmbedder(configEmb);
    if (!embedder) {
      console.log('Embedder not available; skipping semantic timings.');
    } else {
      const embedTime = await timeAsync(async () => {
        await embedder.embed('NeedleInHaystack');
      });
      console.log('Query embedding (single phrase):          median %d ms', ms(embedTime));

      const vectorSearchTime = await timeAsync(async () => {
        const vec = await embedder.embed('NeedleInHaystack');
        await searchVector(configEmb, vec, 20);
      });
      console.log('Embed + vector search (k=20):             median %d ms', ms(vectorSearchTime));

      const precomputedVec = await embedder.embed('query');
      const vectorOnlyTime = await timeAsync(async () => {
        await searchVector(configEmb, precomputedVec, 10);
      });
      console.log('Vector search only (k=10, no embed):       median %d ms', ms(vectorOnlyTime));
    }

    section('FTS with embeddings enabled (same as FTS-only path)');
    const ftsWithEmb = timeSync(() => {
      searchFts(configEmb, { query: 'Content', limit: 10 });
    });
    console.log('Query "Content":  median %d ms', ms(ftsWithEmb));
  }

  section('Summary');
  console.log('FTS: short query, needle-in-large, phrase, getRecentContext.');
  if (RUN_SEMANTIC) {
    console.log('Semantic: query embed + vector KNN (npm run bench:search:embed).');
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
