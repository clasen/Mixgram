# Mixgram 2 verification

Run `npm test` for scenario tests, `npm run test:large` for a document exceeding 100k characters, and `npm run quality` for duplication/dead-code checks. Each scenario owns temporary storage and closes its connections/watchers.

## Required scenarios

- Create distinct documents with identical titles; update by ID and explicit key; isolate keys between collections.
- Preserve omitted fields and distinguish explicit empty content/tags and null key. Reject unknown IDs and conflicting keys before writes.
- Delete SQLite and rebuild: preserve identity, tags, keys, timestamps, bodies and soft deletions. Hard-delete a previously soft-deleted file.
- Edit frontmatter by hand and move files between collection folders. Incremental/full indexing and watcher events reflect the changes. Duplicate IDs and malformed files produce visible errors.
- Apply collection/type/all-tag filters before pagination in recent, textual and semantic searches. Semantic distractors outside the selected collection must not hide eligible documents.
- Fuse documents matching both retrieval methods only once. Ignore vectors with old content hashes. Return useful text results with explicit semantic degradation.
- Inject an index failure after a file write; assert the saved/indexed distinction and recovery by reindexing.
- Deep merge configuration, reject overlapping roots and reject legacy databases without modifying their bytes.
- Isolate two database/vector/worker instances; closing one must not affect the other.
- Exercise an MCP client through the SDK transport and actual CLI subprocesses. Confirm the six tools, identical query output, update omission/clearing semantics and invalid input rejection.

## Evidence boundaries

Normal tests use real SQLite and sqlite-vec with deterministic vectors. They do not download or assess the language model. Optional embedding demonstrations/benchmarks exercise model inference separately. Watcher tests use Chokidar polling for reproducibility on hosts with restricted native watch resources. Benchmarks are opt-in and are not correctness tests.
