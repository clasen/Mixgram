# TDD

## Mixgram

### Black-box Test Design for an Engram-compatible MCP memory system with Markdown source of truth, SQLite text indexing, and optional asynchronous local embeddings

**Status:** Final
**Test approach:** Black-box
**System under test:** Mixgram
**Primary compatibility target:** Engram MCP tool contract
**Source of truth:** Markdown files
**Text retrieval:** SQLite + FTS5
**Semantic retrieval:** Optional local embeddings, asynchronous
**Language:** English

---

# 1. Purpose

This document defines the **black-box test design** for Mixgram.

The goal is to verify the system from the outside, based on:

* MCP tool behavior
* file-system side effects
* search and retrieval behavior
* indexing behavior
* scope behavior
* optional semantic behavior
* failure and degradation behavior

These tests intentionally avoid coupling to internal implementation details such as repository classes, SQL statements, queue internals, parser internals, or watcher internals.

The system passes these tests if it behaves correctly from the perspective of:

* an MCP client
* a user editing Markdown files
* a retrieval workflow consuming the stored knowledge

---

# 2. Black-box scope

## 2.1 Included

* MCP-compatible tool behavior
* Markdown persistence behavior
* full-text retrieval behavior
* scope handling
* `home` versus `project` knowledge behavior
* deduplication and update semantics
* session behavior
* prompt behavior
* rebuild and reindex behavior
* embeddings disabled behavior
* embeddings enabled asynchronous behavior
* graceful degradation when semantic indexing is unavailable
* configurable full-text vs semantic search weight when embeddings are enabled

## 2.2 Excluded

* internal method calls
* internal database schema correctness beyond observable outcomes
* queue implementation details
* private ranking formulas
* exact chunking internals unless visible in output behavior
* internal file watcher mechanism

---

# 3. Test strategy

## 3.1 Test philosophy

The system is tested as a product, not as a collection of modules.

Each test defines:

* initial conditions
* external action
* observable outcome

## 3.2 Observable interfaces

The black-box surfaces are:

* MCP tools
* created or updated Markdown files
* search results
* returned observation data
* stats output
* reindex behavior
* behavior when semantic indexing is off or delayed

## 3.3 Pass/fail rule

A test passes if the externally visible behavior matches the specified result, regardless of how the system achieves it.

---

# 4. Test environments

At minimum, tests should run in these environments.

## 4.1 Environment A: text-only mode

* embeddings disabled
* watcher enabled
* SQLite empty at start

## 4.2 Environment B: semantic optional mode

* embeddings enabled
* local embedding worker available
* asynchronous queue enabled

## 4.3 Environment C: semantic unavailable mode

* embeddings enabled in config
* embedding worker unavailable or provider failing

This environment is critical because the system must still work.

---

# 5. Core test data model

The following kinds of documents should exist in fixtures:

* `home` architecture note
* `home` pattern note
* `project` decision note
* `project` bug note
* `project` session summary
* `project` learning note
* a duplicate or near-duplicate note
* a note that is later manually edited
* a note with a shared topic between `home` and `project`

---

# 6. Functional areas under test

1. Markdown persistence
2. MCP compatibility
3. Topic-key upsert behavior
4. Scope-aware retrieval
5. Full-text search
6. Snippet retrieval
7. Session lifecycle
8. Prompt storage
9. Reindexing and rebuild
10. Embeddings disabled mode
11. Embeddings enabled asynchronous mode
12. Failure tolerance
13. Stats and observability
14. Configurable search weight (full-text vs semantic)

---

# 7. Test cases

## 7.1 `mem_save` creates a new project-scoped document

**ID:** BB-001
**Preconditions:**

* system is running
* project `castlebravo` exists
* no prior document with topic key `architecture/sqlite-derived-index`

**Action:**
Call `mem_save` with:

* title: `Use SQLite as derived index`
* type: `decision`
* scope: `project`
* project: `castlebravo`
* topic_key: `architecture/sqlite-derived-index`
* content: meaningful body text

**Expected result:**

* the tool returns success
* one Markdown file is created under the project memory tree
* the file contains frontmatter with matching metadata
* the content is searchable immediately through text search
* the result is retrievable through `mem_get_observation`

---

## 7.2 `mem_save` creates a new home-scoped document

**ID:** BB-002
**Preconditions:**

* no prior `home` document with the same topic key

**Action:**
Call `mem_save` with:

* scope: `home`
* no project
* type: `pattern`
* topic_key: `pattern/incremental-reindexing`

**Expected result:**

* a Markdown file is created under `home/memory/patterns/`
* the document is searchable from a global context
* the document is also retrievable in merged project search mode

---

## 7.3 `mem_save` with existing topic key updates instead of creating a second document

**ID:** BB-003
**Preconditions:**

* an existing project document has topic key `architecture/sqlite-derived-index`

**Action:**
Call `mem_save` again with the same:

* scope
* project
* topic key

but updated content

**Expected result:**

* no second Markdown document is created for the same logical topic
* the original document content is updated
* `revision_count` is increased
* search reflects the updated content
* `mem_get_observation` returns the updated version

---

## 7.4 `mem_update` updates document by ID

**ID:** BB-004
**Preconditions:**

* an existing document is available
* its ID is known

**Action:**
Call `mem_update` with:

* id
* updated title
* updated content

**Expected result:**

* the same Markdown file is updated
* `updated_at` changes
* `revision_count` increases
* old terms are no longer dominant in search
* new terms become searchable

---

## 7.5 `mem_delete` soft delete hides document from normal search

**ID:** BB-005
**Preconditions:**

* an existing searchable document is available

**Action:**
Call `mem_delete` with:

* id
* hardDelete: false

**Expected result:**

* the Markdown file remains present unless the product explicitly rewrites soft-deleted files elsewhere
* the document is marked deleted in observable metadata
* the document is excluded from normal `mem_search`
* direct retrieval behavior follows product policy, but deleted state must be visible if retrieved

---

## 7.6 `mem_delete` hard delete removes retrievability

**ID:** BB-006
**Preconditions:**

* an existing document is available

**Action:**
Call `mem_delete` with:

* id
* hardDelete: true

**Expected result:**

* the Markdown file is removed
* the document no longer appears in search
* `mem_get_observation` no longer returns it as an active observation

---

## 7.7 `mem_suggest_topic_key` returns a stable category-aligned topic key

**ID:** BB-007
**Preconditions:**

* system running

**Action:**
Call `mem_suggest_topic_key` with:

* title indicating a bug
* content describing timeline ordering problems

**Expected result:**

* the returned topic key is non-empty
* it follows a stable category structure
* it reflects the document type semantically
* repeated calls with equivalent input produce compatible results

---

## 7.8 `mem_search` returns relevant full-text results when embeddings are disabled

**ID:** BB-008
**Environment:** text-only mode

**Preconditions:**

* multiple documents exist
* at least one contains a unique phrase such as `derived SQLite index`

**Action:**
Call `mem_search` with a text query targeting that phrase

**Expected result:**

* relevant result is returned
* result includes snippet-like context
* result includes enough metadata to identify the document
* system works with no semantic layer active
* search ranking is determined solely by full-text (FTS/BM25); no semantic contribution (effective 100% full-text)

---

## 7.9 `mem_search` supports merged project + home retrieval

**ID:** BB-009
**Preconditions:**

* project note exists
* home note exists
* both are relevant to the query

**Action:**
Run a project-context search in merged mode

**Expected result:**

* both project and home results may appear
* project-specific result ranks above home result when both are similarly relevant
* home result remains available as fallback/global knowledge

---

## 7.10 `mem_search` supports project-only retrieval

**ID:** BB-010
**Preconditions:**

* both home and project documents exist

**Action:**
Run search restricted to project scope only

**Expected result:**

* only project-scoped results are returned
* no home documents appear

---

## 7.11 `mem_search` supports home-only retrieval

**ID:** BB-011
**Preconditions:**

* both home and project documents exist

**Action:**
Run search restricted to home scope only

**Expected result:**

* only home-scoped results are returned

---

## 7.12 `mem_search` returns snippets rather than only whole-document blobs

**ID:** BB-012
**Preconditions:**

* a long document exists with multiple sections
* query targets a specific section

**Action:**
Call `mem_search`

**Expected result:**

* result includes a focused excerpt or snippet
* snippet is relevant to the matched section
* heading or section context is visible if supported

---

## 7.13 `mem_get_observation` returns full document content

**ID:** BB-013
**Preconditions:**

* a document exists

**Action:**
Call `mem_get_observation` with its ID

**Expected result:**

* full content is returned
* metadata includes document identity information
* metadata includes scope
* metadata includes project when applicable
* metadata includes topic key when present

---

## 7.14 `mem_context` returns usable contextual memory for a project

**ID:** BB-014
**Preconditions:**

* project contains multiple relevant notes, such as decision, learning, session summary

**Action:**
Call `mem_context` for that project

**Expected result:**

* response contains condensed useful context
* response is not empty
* context reflects project-local knowledge
* merged mode may also include relevant home knowledge

---

## 7.15 `mem_timeline` returns surrounding session observations

**ID:** BB-015
**Preconditions:**

* multiple observations exist in the same session
* one target observation is in the middle

**Action:**
Call `mem_timeline` using the middle observation ID

**Expected result:**

* response contains before/focus/after structure or equivalent observable ordering
* the focus observation is clearly identifiable
* neighboring observations are chronologically meaningful

---

## 7.16 `mem_session_start` creates a session

**ID:** BB-016
**Preconditions:**

* no session with the given ID exists

**Action:**
Call `mem_session_start`

**Expected result:**

* success is returned
* the session becomes available for subsequent memory operations
* later observations can attach to this session

---

## 7.17 `mem_session_end` closes a session

**ID:** BB-017
**Preconditions:**

* an active session exists

**Action:**
Call `mem_session_end`

**Expected result:**

* success is returned
* session metadata reflects closure
* later timeline/session retrieval reflects ended state if exposed

---

## 7.18 `mem_session_summary` persists a session summary as durable memory

**ID:** BB-018
**Preconditions:**

* session exists

**Action:**
Call `mem_session_summary` with summary content

**Expected result:**

* a session summary note is stored as durable memory
* it is searchable
* it is associated with the relevant session/project

---

## 7.19 `mem_save_prompt` stores prompt data without requiring Markdown persistence by default

**ID:** BB-019
**Preconditions:**

* session exists

**Action:**
Call `mem_save_prompt`

**Expected result:**

* success is returned
* prompt contributes to prompt statistics
* prompt storage behavior matches product policy
* core memory behavior is unaffected

---

## 7.20 `mem_stats` reflects stored memory

**ID:** BB-020
**Preconditions:**

* system contains documents, sessions, and prompts

**Action:**
Call `mem_stats`

**Expected result:**

* counts are non-zero where expected
* reported totals are consistent with prior actions
* stats do not require embeddings to be enabled

---

# 8. Manual Markdown edit test cases

## 8.1 Manual edit updates search results after reindex

**ID:** BB-021
**Preconditions:**

* a document exists
* current content is searchable by phrase A

**Action:**
Manually edit the Markdown file:

* remove phrase A
* add phrase B

Wait for automatic reindex or trigger official reindex command

**Expected result:**

* phrase A is no longer the primary match
* phrase B becomes searchable
* `mem_get_observation` reflects edited content

---

## 8.2 Manual creation of a valid Markdown file becomes searchable

**ID:** BB-022
**Preconditions:**

* none

**Action:**
Manually place a valid Markdown memory file in a watched directory

**Expected result:**

* file becomes indexed
* file appears in search
* metadata is retrievable through observation access if identity is supported

---

## 8.3 Manual deletion removes search visibility

**ID:** BB-023
**Preconditions:**

* a valid indexed Markdown file exists

**Action:**
Delete the file manually and allow reindexing

**Expected result:**

* document no longer appears in normal search
* retrieval reflects deletion according to product policy

---

# 9. Rebuild and recovery test cases

## 9.1 Full reindex rebuilds index from Markdown files

**ID:** BB-024
**Preconditions:**

* multiple valid Markdown files exist
* SQLite index exists and is then removed

**Action:**
Run the official full reindex command

**Expected result:**

* the text index is rebuilt successfully
* all valid Markdown notes become searchable again
* no loss of canonical memory occurs

---

## 9.2 Unchanged files are not duplicated after reindex

**ID:** BB-025
**Preconditions:**

* indexed corpus exists

**Action:**
Run normal incremental reindex without changing files

**Expected result:**

* no duplicate documents appear
* search result counts remain stable
* stats remain logically consistent

---

# 10. Home versus project behavior

## 10.1 Home knowledge is reusable in project search

**ID:** BB-026
**Preconditions:**

* a home-scoped reference note exists
* project does not yet contain equivalent local knowledge

**Action:**
Search from project context in merged mode

**Expected result:**

* home note is returned
* it is visible as reusable supporting knowledge

---

## 10.2 Project knowledge outranks home knowledge in project context

**ID:** BB-027
**Preconditions:**

* both home and project notes cover similar topic
* project note is specifically tailored to the active project

**Action:**
Search in merged mode from the project context

**Expected result:**

* project-specific note ranks higher than home note
* home note may still appear

---

## 10.3 Saving project-scoped memory does not overwrite home-scoped memory accidentally

**ID:** BB-028
**Preconditions:**

* home document exists with topic key `pattern/incremental-reindexing`

**Action:**
Call `mem_save` for a project-scoped note with a similar topic key

**Expected result:**

* the project note is saved within project scope
* home note remains intact
* scope boundaries are respected

---

# 11. Deduplication behavior

## 11.1 Repeated save of identical content does not create uncontrolled duplicates

**ID:** BB-029
**Preconditions:**

* a document already exists

**Action:**
Call `mem_save` again with effectively identical content and same logical identity

**Expected result:**

* duplicate proliferation does not occur
* either the same document is reused or duplicate handling is reflected in metadata
* search remains clean and usable

---

## 11.2 Near-duplicate content with different topic should remain distinguishable

**ID:** BB-030
**Preconditions:**

* one document exists

**Action:**
Create a second document with similar wording but a different logical topic

**Expected result:**

* both are preserved if they are semantically distinct enough
* retrieval does not collapse legitimate separate notes incorrectly

---

# 12. Embeddings disabled behavior

## 12.1 System fully works with embeddings disabled

**ID:** BB-031
**Environment:** text-only mode

**Preconditions:**

* embeddings disabled in config

**Action:**
Perform normal sequence:

* save
* update
* search
* context
* get observation
* stats

**Expected result:**

* all operations succeed
* search remains useful
* no semantic subsystem is required

---

## 12.2 `mem_stats` reflects disabled semantic mode appropriately

**ID:** BB-032
**Environment:** text-only mode

**Preconditions:**

* embeddings disabled

**Action:**
Call `mem_stats`

**Expected result:**

* stats remain valid
* semantic counters, if present, reflect disabled or zeroed state consistently

---

# 13. Embeddings enabled asynchronous behavior

## 13.1 Save returns before semantic indexing completes

**ID:** BB-033
**Environment:** semantic optional mode

**Preconditions:**

* embeddings enabled
* worker active
* save content large enough to require noticeable background work

**Action:**
Call `mem_save`

**Expected result:**

* tool returns success promptly after durable save and text indexing
* document is searchable immediately via text search
* semantic enrichment may appear later
* operation does not wait for background embedding completion

---

## 13.2 Search works before semantic indexing completes

**ID:** BB-034
**Environment:** semantic optional mode

**Preconditions:**

* recently saved content is still pending semantic indexing

**Action:**
Run `mem_search`

**Expected result:**

* relevant text results are already available
* absence of finished embeddings does not block retrieval

---

## 13.3 Semantic quality may improve after background completion

**ID:** BB-035
**Environment:** semantic optional mode

**Preconditions:**

* embeddings enabled
* query uses paraphrased wording not strongly matching the literal text
* background indexing completes after some delay

**Action:**
Run search before and after semantic completion

**Expected result:**

* initial search may rely mostly on text
* later search may improve recall or ranking
* no regression in basic functionality occurs

---

## 13.4 Updating a document invalidates prior semantic state without breaking text retrieval

**ID:** BB-036
**Environment:** semantic optional mode

**Preconditions:**

* document has already been semantically indexed

**Action:**
Update the document content

**Expected result:**

* text retrieval reflects the new content immediately
* semantic state is refreshed eventually
* no stale semantic result should permanently dominate after update

---

## 13.5 Search blend respects configured full-text vs semantic weight when embeddings enabled

**ID:** BB-036b
**Environment:** semantic optional mode

**Preconditions:**

* embeddings enabled
* search config has configurable `ftsWeight` and `semanticWeight` (e.g. 0.7 and 0.3)
* corpus includes documents that match a query both by literal text and by semantic similarity (e.g. paraphrased)

**Action:**
Run `mem_search` with a query that has both lexical and semantic matches

**Expected result:**

* results reflect both full-text and semantic relevance when both are available
* changing the configured weights (e.g. toward more semantic or more full-text) can change the relative ranking of results for the same query
* when semantic indexing is disabled (or unavailable), effective behavior is 100% full-text (see BB-008, BB-031)

---

# 14. Semantic failure tolerance

## 14.1 System remains functional when semantic provider is unavailable

**ID:** BB-037
**Environment:** semantic unavailable mode

**Preconditions:**

* embeddings enabled in config
* provider fails or worker is absent

**Action:**
Perform save and search operations

**Expected result:**

* save still succeeds
* text search still works
* system does not become unusable because semantic indexing failed

---

## 14.2 Semantic job failures do not corrupt durable memory

**ID:** BB-038
**Environment:** semantic unavailable mode

**Preconditions:**

* provider fails repeatedly

**Action:**
Save multiple notes

**Expected result:**

* Markdown files remain correct
* text retrieval remains correct
* failures are isolated to semantic enrichment only

---

# 15. Error handling tests

## 15.1 Invalid save request is rejected cleanly

**ID:** BB-039
**Preconditions:**

* system running

**Action:**
Call `mem_save` with missing required content or invalid arguments

**Expected result:**

* tool returns a clear error
* no malformed durable note is created

---

## 15.2 Invalid update ID is rejected cleanly

**ID:** BB-040
**Preconditions:**

* non-existent document ID

**Action:**
Call `mem_update`

**Expected result:**

* clear failure response
* no unrelated file is modified

---

## 15.3 Invalid observation ID in retrieval returns controlled failure

**ID:** BB-041
**Preconditions:**

* non-existent observation ID

**Action:**
Call `mem_get_observation`

**Expected result:**

* controlled error or not-found result
* no ambiguous success response

---

# 16. Acceptance matrix

The product is acceptable only if all of the following are true:

1. It behaves as an Engram-compatible MCP replacement at the tool level.
2. Markdown is the durable source of truth.
3. Text retrieval works independently of embeddings.
4. Manual file edits are respected after reindex.
5. Home knowledge can be reused across projects.
6. Project-local knowledge remains distinct from home knowledge.
7. Topic-based updates do not create uncontrolled duplication.
8. Rebuild from Markdown files is possible after index loss.
9. Embeddings, when enabled, run asynchronously in the background.
10. Embedding failure does not break core memory operations.
11. When embeddings are disabled, search uses 100% full-text; when enabled, search blend respects configured ftsWeight and semanticWeight.

---

# 17. Suggested execution order

Recommended order for implementation testing:

## Phase 1

* BB-001 through BB-013

## Phase 2

* BB-014 through BB-025

## Phase 3

* BB-026 through BB-032

## Phase 4

* BB-033 through BB-036, BB-036b (search blend), BB-037 through BB-041

## Phase 5 (benchmarks)

* BM-001 through BM-006 as needed; baseline establishment and regression checks

---

# 18. Executive summary

This TDD verifies Mixgram as a **black-box MCP memory system** with these guarantees:

* durable Markdown memory
* rebuildable SQLite retrieval
* project and home knowledge scopes
* clean topic-based update behavior
* full functionality with embeddings disabled
* asynchronous semantic indexing when enabled
* graceful fallback when semantic indexing fails
* configurable full-text vs semantic search weight when embeddings are enabled (e.g. 100% FTS when disabled; 70% FTS / 30% semantic when enabled)
* **performance benchmarks** (section 19) for tool latency and reindex duration, with baseline and regression targets

The key testing rule is simple:

> The system must always remain useful and correct in text-only mode. Semantic indexing may improve retrieval, but it must never become a dependency for core behavior.

---

# 19. Benchmarks

Benchmarks define **performance targets** observable from outside the system (MCP client timing, reindex duration). They are not unit-level; they measure end-to-end tool behavior and indexing under defined conditions.

## 19.1 Scope

* Tool response latency (e.g. `mem_save`, `mem_search`, `mem_get_observation`, `mem_context`)
* Full reindex duration from Markdown corpus to searchable state
* Optional: sustained throughput for repeated saves or searches

All timings are measured from the client’s perspective (e.g. time from tool call to tool response). Environment (text-only vs semantic, corpus size) must be stated for each benchmark.

## 19.2 Environment assumptions

* **Benchmark environment:** Same machine class for baseline comparisons; cold vs warm index may be specified.
* **Corpus size:** Small (e.g. &lt; 100 docs), medium (e.g. 500–2K), or large (e.g. 10K+) as needed per benchmark.
* **Embeddings:** Benchmarks may be defined for text-only mode only, or for semantic-optional mode with explicit “before/after embedding” semantics.

## 19.3 Benchmark cases

### 19.3.1 `mem_save` latency (single document)

**ID:** BM-001  
**Environment:** Text-only mode; small or medium corpus.

**Preconditions:**

* System running; index already built for the given corpus size.

**Action:**

* Call `mem_save` once with a typical document (e.g. 1–3 KB body).
* Measure time from request start to tool response (success).

**Target:**

* Response returns within a defined upper bound (e.g. p95 < 500 ms for small/medium corpus on reference hardware).
* Exact threshold to be set per project/reference machine; regression is relative to baseline.

---

### 19.3.2 `mem_search` latency

**ID:** BM-002  
**Environment:** Text-only mode; corpus size stated (e.g. medium).

**Preconditions:**

* Index contains a known number of documents.
* Query is a short phrase that matches at least one document.

**Action:**

* Call `mem_search` with that query.
* Measure time from request start to tool response.

**Target:**

* p95 latency under a defined cap (e.g. < 200 ms for medium corpus on reference hardware).
* Baseline to be established and used for regression checks.

---

### 19.3.3 `mem_context` latency

**ID:** BM-003  
**Environment:** Text-only mode; project with multiple relevant notes.

**Preconditions:**

* Project has a defined number of notes (e.g. 20–50).

**Action:**

* Call `mem_context` for that project.
* Measure time from request start to tool response.

**Target:**

* p95 latency under a defined cap (e.g. < 300 ms on reference hardware).
* Used for regression comparison.

---

### 19.3.4 Full reindex duration

**ID:** BM-004  
**Environment:** Text-only mode.

**Preconditions:**

* A set of valid Markdown memory files exists on disk (count and total size stated).
* SQLite index is missing or cleared.

**Action:**

* Run the official full reindex command.
* Measure time from start until reindex is complete and search is usable.

**Target:**

* Total time under a defined upper bound for the given corpus (e.g. < N seconds for 1K documents on reference hardware).
* Serves as scalability and regression benchmark.

---

### 19.3.5 `mem_search` latency with embeddings enabled (optional)

**ID:** BM-005  
**Environment:** Semantic optional mode; embeddings available and indexed for the corpus.

**Preconditions:**

* Corpus is fully text- and semantic-indexed.
* Query has both lexical and semantic matches.

**Action:**

* Call `mem_search` with blended full-text/semantic config.
* Measure time from request start to tool response.

**Target:**

* p95 latency under a defined cap (e.g. < 400 ms for medium corpus), or no more than a defined multiple of text-only search (e.g. < 2× BM-002).
* Ensures semantic path does not make search unusably slow.

---

### 19.3.6 Throughput: repeated `mem_save` (optional)

**ID:** BM-006  
**Environment:** Text-only mode; small or medium corpus.

**Preconditions:**

* System running; initial corpus size stated.

**Action:**

* Call `mem_save` repeatedly (e.g. 50–100 times) with distinct topic keys and typical content.
* Measure total time and success count.

**Target:**

* No systematic degradation (e.g. p95 per call stays within 2× of BM-001).
* No failures attributable to resource exhaustion.

---

## 19.4 Reporting and regression

* Benchmark results should be reported with: environment (text-only vs semantic), corpus size, and metric (e.g. p95 latency, total reindex time).
* CI or release gates may compare current run to a stored baseline and fail on regression (e.g. p95 > 1.5× baseline).
* Exact thresholds and reference hardware should be documented in the project (e.g. in a `docs/benchmarks.md` or CI config) and updated when the reference environment changes.
