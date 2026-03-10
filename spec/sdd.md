# SDD

## Mixgram

### A Node.js project memory system compatible with Engram MCP, using Markdown as the source of truth, SQLite as the text index, and optional asynchronous local embeddings

**Status:** Final
**Target language:** Node.js
**Compatibility target:** drop-in MCP replacement for Engram
**Source of truth:** Markdown files
**Text index:** SQLite + FTS5
**Semantic index:** optional, local, asynchronous
**Technical references:** Engram, SearchMix, SeekMix

---

# 1. Purpose

This document defines a memory system for software projects and agents that preserves **Engram-compatible MCP interfaces**, while replacing Engram’s storage model with a more transparent architecture:

* **Markdown files are the canonical memory store**
* **SQLite is a derived and rebuildable index**
* **Embeddings are optional**
* **When enabled, embeddings run asynchronously in the background**

The goal is to preserve Engram’s external MCP tool contract while improving visibility, Git compatibility, manual editing, and long-term maintainability.

---

# 2. Core goals

## 2.1 Functional goals

* Replace Engram at the MCP interface level
* Preserve the same tool names and external semantics
* Store durable memory as Markdown files
* Maintain a rebuildable SQLite text index
* Reindex new and modified files automatically
* Support fast full-text retrieval
* Support optional local embeddings
* Continue working fully when embeddings are disabled

## 2.2 Non-functional goals

* Human-readable memory
* Git-friendly workflows
* Minimal external dependencies
* Rebuildable derived state
* Graceful degradation when semantic indexing is unavailable
* Strong support for manual editing
* Clear knowledge reuse across projects

---

# 3. Design principles

## 3.1 Markdown is canonical

All durable, meaningful memory should live as Markdown files.

## 3.2 SQLite is derived

SQLite is not the canonical store. It is a rebuildable search index and retrieval layer.

## 3.3 MCP compatibility first

The system must expose the same MCP tools as Engram so it can replace it in existing integrations.

## 3.4 Full-text is mandatory, embeddings are optional

The system must work correctly with SQLite FTS5 alone. Semantic retrieval is an enhancement, not a requirement.

## 3.5 Embeddings must be asynchronous

If embeddings are enabled, they must be computed in the background. Saving or updating memory must never block on embedding generation.

## 3.6 Human edits win

If a Markdown file is edited manually, the system must treat the file as authoritative and reindex it.

## 3.7 Knowledge should support multiple scopes

Memory should support both:

* **project-local knowledge**
* **cross-project reusable knowledge**

---

# 4. Technical references

## 4.1 Engram

Engram is the MCP compatibility reference. Its tool names, argument structure, and overall memory workflow define the external contract to preserve.

## 4.2 SearchMix

SearchMix is the reference for:

* Markdown-first document indexing
* SQLite FTS5
* BM25 ranking
* incremental reindexing
* document/path-centered indexing
* snippets and structured text retrieval

**Adaptation to Mixgram.** This design takes the same ideas—Markdown parsing, FTS5, BM25, mtime-based incremental reindex, and snippets—but applies them to a **chunk-based** model with **frontmatter**, **scope/type/project**, and an **external file watcher** that triggers indexing. SearchMix has no built-in watch; Mixgram does.

## 4.3 SeekMix

SeekMix is the reference for:

* optional local embeddings
* local vector storage
* configurable semantic thresholds
* provider abstraction for embedding generation

In this design, SeekMix is used as the semantic layer reference, not as a semantic cache model.

---

# 5. Architecture overview

```text
MCP Client / Agent
        |
        v
  MCP Server (Node.js)
        |
        +----------------------------------+
        |                                  |
        v                                  v
 Markdown Memory Store                SQLite Index
 (source of truth)                   (derived state)
        |                                  |
        |                                  +-- documents
        |                                  +-- chunks
        |                                  +-- FTS5
        |                                  +-- sessions
        |                                  +-- prompts
        |                                  +-- tags
        |                                  +-- embedding_jobs
        |                                  +-- vector metadata
        |
        v
 File Watcher / Incremental Reindexer
        |
        v
 Optional Local Embedding Worker
```

---

# 6. Directory conventions

This is the part I would definitely adjust based on what you said.

A **date-first filename convention should not be the default**. Date is useful only for memories where chronology matters. For architecture, reusable knowledge, decisions, patterns, and reference notes, the more important dimensions are:

* scope
* topic
* type
* project relevance

## 6.1 Recommended root structure

```text
workspace/
  home/
    memory/
      architecture/
      decisions/
      patterns/
      reference/
      learnings/
      discoveries/
      prompts/
  projects/
    project-a/
      memory/
        architecture/
        decisions/
        bugs/
        sessions/
        learnings/
        discoveries/
        generated/
    project-b/
      memory/
        architecture/
        decisions/
        bugs/
        sessions/
        learnings/
        discoveries/
        generated/
  .mixgram/
    index.db
    jobs/
    logs/
    cache/
```

## 6.2 Meaning of `home/`

`home/memory/` stores **cross-project knowledge**.

This includes:

* reusable architecture notes
* patterns
* general discoveries
* general learnings
* prompts or workflows relevant across projects
* implementation techniques that should be searchable from any project context

This lets the system reuse knowledge globally instead of duplicating it inside each project.

## 6.3 Meaning of `projects/<name>/memory/`

This stores **project-scoped knowledge**.

This includes:

* project decisions
* project-specific bugs
* session summaries
* feature notes
* implementation details tied to that project
* generated notes that should remain local

## 6.4 Scope model

The system should support at least these scopes:

* `home`
* `project`
* `session`
* `generated`

This scope must be represented both in:

* Markdown frontmatter
* SQLite metadata

---

# 7. Document classification model

Instead of relying primarily on dates in filenames, the system should classify memory by **type + scope + topic**.

## 7.1 Recommended document types

* `architecture`
* `decision`
* `bug`
* `learning`
* `discovery`
* `pattern`
* `reference`
* `session_summary`
* `prompt`
* `generated_note`

## 7.2 Recommended directory mapping

```text
memory/
  architecture/
  decisions/
  bugs/
  learnings/
  discoveries/
  patterns/
  reference/
  sessions/
  prompts/
  generated/
```

This gives both humans and agents a predictable structure.

---

# 8. File naming convention

I would recommend moving away from date-first naming except when time is central.

## 8.1 Default naming format

```text
<type>--<slug>.md
```

Examples:

```text
decision--use-sqlite-derived-index.md
architecture--memory-layer-layout.md
pattern--incremental-reindexing.md
reference--sqlite-fts-ranking-notes.md
```

## 8.2 When date should be included

Only include time in the filename when chronology is important, for example:

* session summaries
* incident investigations
* temporary discoveries
* logs or research trails
* time-sensitive notes

Examples:

```text
session-summary--2026-03-08--agent-debugging.md
bug--2026-03-08--timeline-ordering-regression.md
discovery--2026-03-08--redis-vs-sqlite-observation.md
```

## 8.3 Topic key is more important than the filename

The true identity of evolving knowledge should be driven primarily by:

* `id`
* `topic_key`
* `scope`
* `project`

The filename is a stable human convenience, not the core identity mechanism.

---

# 9. Markdown frontmatter

Each memory document should include structured frontmatter.

```md
---
id: a1b2c3d4e5
title: Use SQLite as derived index
type: decision
scope: project
project: castlebravo
topic_key: architecture/sqlite-derived-index
session_id: f6g7h8i9j0
tool_name: mem_save
created_at: 2026-03-08T18:00:00Z
updated_at: 2026-03-08T18:00:00Z
revision_count: 1
duplicate_count: 0
deleted: false
tags:
  - sqlite
  - indexing
  - architecture
embedding_status: pending
---

# Summary

SQLite will be used as a derived index over Markdown documents.
```

## 9.1 Rules

* `project` may be omitted for `home` scope
* `scope: home` means globally reusable knowledge
* `scope: project` means project-local knowledge
* `scope: session` is intended for chronological notes
* `scope: generated` is for machine-generated notes

---

# 10. Cross-project knowledge behavior

This is an important addition.

## 10.1 Home knowledge must be searchable everywhere

When searching inside a project, the system should be able to retrieve:

* project-local memory
* home/global memory

This means project search should support:

* `local-only`
* `home-only`
* `merged`

The recommended default is **merged**, with local results slightly boosted.

## 10.2 Ranking recommendation

If the same topic exists in both `home` and project scope:

* prefer project-specific content when the query is project-contextual
* still allow home results as fallback or supporting context

Suggested bias:

* `project` scope gets a ranking bonus in project searches
* `home` scope remains fully visible

## 10.3 Reuse rule

If knowledge is broadly reusable, it should be saved under `home/memory/` instead of duplicating it into multiple projects.

---

# 11. SQLite data model

## 11.1 `documents`

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  project TEXT,
  topic_key TEXT,
  session_id TEXT,
  tool_name TEXT,
  content_hash TEXT NOT NULL,
  file_mtime_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  indexed_at TEXT,
  deleted_at TEXT,
  revision_count INTEGER NOT NULL DEFAULT 1,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  embedding_status TEXT NOT NULL DEFAULT 'disabled'
);
```

## 11.2 `document_chunks`

```sql
CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading_path TEXT,
  heading_level INTEGER,
  content TEXT NOT NULL,
  token_count INTEGER,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id)
);
```

## 11.3 `document_tags`

```sql
CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (document_id, tag),
  FOREIGN KEY(document_id) REFERENCES documents(id)
);
```

## 11.4 `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  directory TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT
);
```

## 11.5 `prompts`

```sql
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
```

## 11.6 `embedding_jobs`

```sql
CREATE TABLE embedding_jobs (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(chunk_id) REFERENCES document_chunks(id)
);
```

## 11.7 FTS5

```sql
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  title,
  topic_key,
  type,
  scope,
  project,
  heading_path,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

**Column roles.** The FTS5 table stores two kinds of columns. **UNINDEXED** columns (`chunk_id`, `document_id`) are kept for joins and identity but are not full-text indexed. All other columns (`title`, `topic_key`, `type`, `scope`, `project`, `heading_path`, `body`) are **indexed** and participate in `MATCH` and BM25 ranking.

**Normalization.** Indexable text should be normalized so that search is case- and accent-insensitive. The tokenizer `unicode61 remove_diacritics 2` contributes to this. Any application-side normalization (e.g. NFD, remove diacritics, lowercase) for title or heading_path should match the same rules so that query terms align with indexed content.

**BM25.** Ranking uses FTS5’s BM25 with configurable weights (see §18 `indexing.ftsWeights`: title, topicKey, heading, body) so that matches in title and topic_key rank higher than body-only matches.

---

## 11.8 Vector cache and vec tables (optional, when semantic indexing enabled)

When embeddings are enabled, the same SQLite DB (or a dedicated DB) holds per-model cache and vector tables. Suffix is derived from the sanitized embedding model name (e.g. `Xenova_multilingual_e5_large`).

**Metadata table** (links chunk to vector row):

```sql
CREATE TABLE cache_<suffix> (
  id INTEGER PRIMARY KEY,
  chunk_id TEXT NOT NULL UNIQUE,
  document_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(chunk_id) REFERENCES document_chunks(id),
  FOREIGN KEY(document_id) REFERENCES documents(id)
);
```

**Vector table** (sqlite-vec virtual table; rowid must align with `cache_<suffix>.id`):

```sql
-- After sqliteVec.load(db):
CREATE VIRTUAL TABLE vec_<suffix> USING vec0(
  embedding float[1024],
  distance_metric=cosine
);
```

**Insert:** Insert into `cache_<suffix>`, then insert into `vec_<suffix>` with `rowid = cache_<suffix>.id` and `embedding = Float32Array(embedding)`. **Search:** KNN via `WHERE embedding MATCH ? AND k = N`, then join `vec_<suffix>.rowid = cache_<suffix>.id`. See §13.7.4 and §13.7.5.

---

# 12. Text indexing

## 12.1 Immediate consistency

Every create or update operation must synchronously update:

* documents
* chunks
* tags
* FTS

## 12.2 Incremental reindexing

The watcher/indexer must:

* detect new files
* detect modified files
* skip unchanged files
* reindex only what changed

## 12.3 Chunking strategy

Chunking should be semantic:

* split by headings when possible
* preserve heading hierarchy
* avoid tiny fragments
* keep chunk size configurable

## 12.4 Weighted retrieval

Search should favor:

* title
* topic key
* heading path
* body

This follows the SearchMix-style principle of field-aware ranking.

## 12.5 Indexing pipeline (SearchMix-inspired)

The indexer follows a single pipeline from input to FTS5 and metadata writes.

* **Input.** The pipeline accepts a path to a `.md` file, a directory, or in-memory content (e.g. from `mem_save`).
* **Type detection.** The system distinguishes file vs directory. For directories, it recurses and selects `*.md` / `*.markdown` with optional exclude patterns.
* **Read and encoding.** File content is read; encoding is detected (e.g. jschardet) and decoded to UTF-8 (e.g. iconv-lite) so that non-UTF-8 Markdown is supported.
* **Markdown parsing.** Content is parsed with a unified/remark-style pipeline to an AST. The implementation extracts frontmatter (id, title, type, scope, project, topic_key, etc.) and body structure (headings h1–h6, paragraphs, optional code blocks), and builds a section tree (id, parentId, childrenIds) and a flat sections index with positions for snippet boundaries.
* **Chunking.** Chunks are derived from the section tree and headings (see §12.3). Each chunk gets heading_path, heading_level, content, and optional token_count and content_hash.
* **Write.** The pipeline updates `documents`, `document_chunks`, `document_tags`, and the FTS5 table, and stores `file_mtime_ms` (or equivalent) for mtime-based skip on the next run.

This pipeline is invoked by (a) the file watcher when a file is added or changed, (b) explicit reindex APIs, and (c) `mem_save` / `mem_update` for in-memory content.

## 12.6 Watch and incremental reindex (difference from SearchMix)

SearchMix has no built-in file watch; reindexing happens only when the caller invokes an add-document API, and mtime is used inside that call to skip unchanged files.

Mixgram includes a **file watcher** (e.g. chokidar or `fs.watch`) that observes configured roots for new, changed, and deleted Markdown files and calls the indexer (add/update/remove). When the indexer runs—whether from the watcher or from an explicit reindex—it uses **mtime** (with optional tolerance, e.g. 1s) to skip unchanged files and reindex only modified or new ones. Options such as skip-when-unchanged (e.g. `checkModified` / `skipExisting`) can be supported: skip reindex when the stored mtime matches and the document is already in the index.

## 12.7 Search resolution and snippets

* **Query execution.** Search is performed with SQLite FTS5 (`WHERE document_chunks_fts MATCH ?`). The query string is **normalized** using the same rules as indexed text (e.g. NFD, remove diacritics, lowercase), while respecting FTS5 operators (AND, OR, NOT, quoted phrases).
* **Field prefixes.** If the design supports field-scoped search (e.g. `title:`, `body:`), these are mapped to the corresponding FTS5 columns in the normalized query.
* **Ranking.** Results are ordered by BM25 with the configured weights; an optional `minScore` threshold may filter weak matches.
* **Filters.** Optional scope, project, or tag filters (e.g. via `documents` / `document_tags`) are applied in SQL (JOIN or subquery).
* **Snippets.** For each result, snippets are extracted by finding query terms (after stripping operators) in the normalized title, heading_path, and body. The section/chunk structure and stored positions are used to trim context (snippet length configurable) and attach the snippet to the correct chunk/section. Snippet objects include range, document/chunk id, and optional hierarchy (e.g. heading path).

## 12.8 Libraries for indexing and search (reference)

The following libraries are used for indexing and search. This is a reference list; actual dependencies may be chosen to match the project’s constraints (e.g. ESM vs CJS).

| Purpose | Library / stack | Role in Mixgram |
|---------|------------------|-----------------|
| SQLite + FTS5 | better-sqlite3 | Database and FTS5 index; BM25 ranking. |
| Markdown AST | unified, remark-parse | Parse Markdown to AST. |
| AST traversal | unist-util-visit | Walk AST to extract headings, paragraphs, sections, positions. |
| Language detection | franc (optional) | Optional tag or metadata for document language. |
| File discovery | glob (or similar) | List `*.md` / `*.markdown` in directories; optional recursion and exclude (e.g. micromatch). |
| Encoding | jschardet, iconv-lite | Detect file encoding and decode to UTF-8. |
| File watch | chokidar or fs.watch | Detect filesystem changes and trigger reindex (Mixgram-specific). |

---

# 13. Optional semantic layer

## 13.1 Rule

Embeddings are optional.

The system must fully function when embeddings are disabled.

## 13.2 When disabled

Everything still works:

* `mem_save`
* `mem_update`
* `mem_delete`
* `mem_search`
* `mem_context`
* `mem_timeline`
* `mem_get_observation`
* session tools
* prompt tools

## 13.3 When enabled

If embeddings are enabled:

* chunks are queued for semantic indexing
* a local worker processes them asynchronously
* vector results may improve retrieval quality
* write operations still return immediately after text indexing

## 13.4 Why asynchronous

Embedding generation is expensive. It must run behind the main flow and must never block save/update operations.

## 13.5 Status values

Each chunk can be:

* `disabled`
* `pending`
* `processing`
* `completed`
* `failed`
* `stale`

## 13.6 Invalidation

Embeddings become `stale` when:

* chunk content changes
* embedding model changes
* chunking strategy changes

## 13.7 Technical implementation (default local semantic indexing)

When semantic indexing is enabled, Mixgram uses the same stack as SeekMix’s default local setup. The following is the technical reference for replication and implementation.

### 13.7.1 Architecture summary

| Component        | Technology / model |
|------------------|---------------------|
| Embeddings       | Produced locally by **Hugging Face Transformers.js** (`@huggingface/transformers`), no API keys. |
| Storage          | **SQLite** (`better-sqlite3`) with the **sqlite-vec** extension for vector similarity search. |
| Matching         | Cosine similarity over normalized embeddings; configurable threshold (default `0.87`). |

### 13.7.2 Default embedding model

| Property     | Value |
|-------------|--------|
| **Provider**  | HuggingfaceProvider (local) |
| **Model**     | `Xenova/multilingual-e5-large` |
| **Dimensions**| 1024 (from model `hidden_size`) |
| **Library**   | `@huggingface/transformers` |
| **Pipeline**  | `feature-extraction` |
| **Quantization** | `dtype: 'q8'` (optional, for smaller/faster load) |

The **Xenova/** prefix indicates the model is used in ONNX form via Transformers.js; the first run downloads it from Hugging Face, then it runs fully on-device.

### 13.7.3 How embeddings are produced (local)

* **One-time init:** `pipeline('feature-extraction', 'Xenova/multilingual-e5-large', { dtype: 'q8' })` (model download on first run).
* **Per-text embedding:** Mean pooling over token embeddings (no CLS-only), then L2-normalize. Cosine similarity is then equivalent to dot product.
* **Output:** Array of 1024 floats; same format is stored and used for search.

Example pattern:

```javascript
const output = await extractor(text, { pooling: 'mean', normalize: true });
const embedding = output.tolist();  // 1024-dim, L2-normalized
```

### 13.7.4 Vector storage (sqlite-vec)

* **DB:** Single SQLite file (e.g. same as main index or a dedicated DB). One DB can host multiple logical caches per embedding model via different table name suffixes (e.g. sanitized model name: `Xenova_multilingual_e5_large`).

* **Tables per model:**

  1. **Metadata table** `cache_<suffix>`: `id` (PK), `chunk_id` (unique), `document_id`, `content_hash`, `embedding_model`, `created_at`, etc. Links chunk identity and metadata to vector rows.

  2. **Vector table** `vec_<suffix>` (sqlite-vec virtual table): `vec0(embedding float[1024] distance_metric=cosine)`. Row count matches cache; **rowid** of the vector table equals **id** of the cache table for joins.

* **Insert (indexing):** Insert row into `cache_<suffix>` → get `id` → insert into `vec_<suffix>` with `rowid = id` and `embedding = Float32Array(embedding)`.

* **Extension:** `sqliteVec.load(db)` once per connection; vectors stored as float32.

### 13.7.5 Search flow (KNN + threshold)

1. **Embed** the incoming query with the same model and options (mean pooling + normalize).
2. **KNN query** (sqlite-vec), e.g.:
   ```sql
   SELECT rowid, distance
   FROM vec_<suffix>
   WHERE embedding MATCH ?
     AND k = N
   ORDER BY distance;
   ```
   For tag/scope filtering, `k` is increased and results are filtered in application code.
3. **Join** with `cache_<suffix>` on `cache.id = vec.rowid` to get chunk_id, document_id, etc., then join to `document_chunks` / `documents` for full metadata and snippets.
4. **Similarity threshold:** sqlite-vec returns **cosine distance** (0 = identical). Convert to similarity as `similarity = 1 - distance`. Accept a hit only if `similarity >= similarityThreshold` (default `0.87`, from config `embeddings.similarityThreshold`).
5. **Optional:** TTL, tag/scope filters (e.g. require all requested tags or scope).

### 13.7.6 Dependencies for replication

```json
{
  "@huggingface/transformers": "^3.4.2",
  "better-sqlite3": "^11.10.0",
  "sqlite-vec": "^0.1.6"
}
```

Node must support native addons for `better-sqlite3` and `sqlite-vec`. First run downloads `Xenova/multilingual-e5-large` from Hugging Face (no API key for the model).

### 13.7.7 Summary table

| Component        | Technology / model |
|-----------------|---------------------|
| Embedding model | Xenova/multilingual-e5-large (1024 dims) |
| Embedding lib   | @huggingface/transformers, feature-extraction pipeline |
| Pooling/norm    | mean pooling, normalize: true |
| DB              | SQLite (better-sqlite3) |
| Vector index    | sqlite-vec vec0, cosine |
| Match rule      | cosine similarity ≥ 0.87 (configurable via `embeddings.similarityThreshold`) |

---

## 13.8 Search score blending (full-text vs semantic)

Retrieval can combine full-text (FTS5/BM25) and semantic (vector) results. The blend is controlled by configuration.

### 13.8.1 When semantic indexing is disabled

* **Effective weights:** 100% full-text, 0% semantic.
* **Behavior:** All search (e.g. `mem_search`, `mem_context`) uses only FTS5 and BM25. Config keys such as `search.semanticWeight` are ignored; no vector queries are run.

### 13.8.2 When semantic indexing is enabled

* **Effective weights:** Configurable via `search.ftsWeight` and `search.semanticWeight` (see §18).
* **Example:** `ftsWeight: 0.7`, `semanticWeight: 0.3` → 70% full-text, 30% semantic.
* **Normalization:** Weights should be normalized so that `ftsWeight + semanticWeight === 1.0`. If only one source is available (e.g. no vectors for a chunk), the available scores are used and the blend applies to the set of results that have both FTS and semantic scores where applicable.
* **Combination:** Implementation may use normalized FTS score (e.g. BM25 normalized to a 0–1 scale) and semantic similarity (already 0–1); combined score = `ftsWeight * normFtsScore + semanticWeight * similarity`. Ranking and filtering (e.g. `minScore`) apply to this combined score.

### 13.8.3 Configuration rule

* If `embeddings.enabled === false` → treat as 100% full-text (semantic weight 0).
* If `embeddings.enabled === true` → use `search.ftsWeight` and `search.semanticWeight`; default suggestion: 70% FTS, 30% semantic (e.g. `0.7` and `0.3`).

---

# 14. MCP compatibility requirements

The system must expose the same Engram-compatible tools.

## 14.1 Required tools

* `mem_save`
* `mem_update`
* `mem_delete`
* `mem_suggest_topic_key`
* `mem_search`
* `mem_context`
* `mem_timeline`
* `mem_get_observation`
* `mem_session_summary`
* `mem_session_start`
* `mem_session_end`
* `mem_save_prompt`
* `mem_stats`

## 14.2 Compatibility rule

This system does not need to match Engram internally. It must match it **at the MCP tool contract level** closely enough to replace it in practice.

---

# 15. Identity, upsert, and deduplication

## 15.1 Resolution order

1. If `id` is provided, update that exact document
2. If `topic_key` exists within the relevant scope, update that document
3. If recent normalized content matches, increment `duplicate_count`
4. Otherwise create a new Markdown document

## 15.2 Scope-aware topic resolution

Topic matching must respect scope:

* `home` topic keys should update global documents
* `project` topic keys should update local documents
* project tools may optionally consult `home` for reuse suggestions, but should not overwrite home documents accidentally

---

# 16. Search behavior with `home` and `project`

## 16.1 Search modes

* `project-only`
* `home-only`
* `merged`

## 16.2 Recommended default

For project workflows, use `merged`.

That gives the agent:

* local project context
* shared global knowledge

## 16.3 Ranking policy

Default ranking should slightly prefer:

1. exact `topic_key`
2. same project
3. same scope
4. home/global fallback
5. when semantic indexing is enabled: combined score from full-text and semantic (see §13.8); when disabled: full-text only (100% FTS).

---

# 17. Suggested internal Node.js structure

```text
src/
  mcp/
    server.ts
    tools/
  core/
    documents/
    indexing/
    search/
    sessions/
    prompts/
    embeddings/
  db/
    sqlite.ts
    migrations/
    fts/
    vec/
  fs/
    watcher.ts
    paths.ts
  utils/
    hash.ts
    markdown.ts
    yaml.ts
    ids.ts
```

---

# 18. Suggested config

```json
{
  "homeMemoryRoot": "~/.mixgram/docs",
  "sqlitePath": "~/.mixgram/index.db",
  "watch": true,
  "indexing": {
    "chunkSize": 1200,
    "chunkOverlap": 120,
    "reindexOnStartup": true,
    "ftsWeights": {
      "title": 10.0,
      "topicKey": 8.0,
      "heading": 5.0,
      "body": 1.0
    }
  },
  "embeddings": {
    "enabled": false,
    "mode": "optional",
    "provider": "local-huggingface",
    "vectorStore": "sqlite-vec",
    "model": "default-seekmix-reference",
    "workerConcurrency": 2,
    "maxRetries": 3,
    "queueOnWrite": true,
    "similarityThreshold": 0.87
  },
  "search": {
    "mode": "fts-only",
    "defaultLimit": 10,
    "ftsWeight": 0.7,
    "semanticWeight": 0.3,
    "defaultScopeMode": "merged"
  }
}
```

**Search weights.** When `embeddings.enabled` is `false`, search uses **100% full-text** (FTS5/BM25); `search.semanticWeight` is ignored. When `embeddings.enabled` is `true`, `search.ftsWeight` and `search.semanticWeight` define the blend (e.g. `0.7` and `0.3` → 70% full-text, 30% semantic). These two values should be normalized (e.g. sum to 1.0).

---

The system is acceptable when:

1. It can replace Engram at the MCP interface level
2. Saving memory creates or updates Markdown and immediately updates the text index
3. Manual Markdown edits trigger incremental reindexing
4. Deleting SQLite and running full reindex reconstructs the index from files
5. The system works fully with embeddings disabled
6. When embeddings are enabled, they run asynchronously and never block save/update flows
7. `home` knowledge is reusable across projects
8. Project searches can retrieve both local and home knowledge
9. File organization is understandable to humans without opening SQLite
10. Git diffs remain meaningful for durable knowledge

---

# 20. Executive summary

This design keeps **Engram’s MCP interface**, but replaces opaque database-first memory with a more durable and inspectable structure:

* **Markdown is the system of record**
* **SQLite is a rebuildable retrieval layer**
* **SearchMix inspires the text indexing model**
* **SeekMix inspires the optional semantic layer**
* **Embeddings are optional and asynchronous**
* **Global reusable knowledge lives under `home/`**
* **Project-specific knowledge lives under each project’s `memory/` directory**

And the key structural decision is this:

> **Store durable knowledge by scope and type, not by date. Use dates only when time is actually part of the meaning.**

If you want, next I can turn this into a **clean Markdown file artifact** named something like `SDD-Mixgram-final-en.md`, or I can produce the **black-box TDD in English** that matches this SDD.
