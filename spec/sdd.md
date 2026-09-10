# Mixgram 2 design

Mixgram stores general knowledge as Markdown documents organized into named collections. MCP and CLI expose six operations: save, search/list, get, delete, stats and reindex. There are no session resources, prompt tables or Engram aliases.

## Document contract

A document has an ID, title, free-form type, nullable key, tags, creation/update/deletion timestamps and a Markdown body. Persist metadata in frontmatter. Derive collection from the configured folder, not from SQLite or file metadata. New IDs are UUIDs; filename slugs are cosmetic. Ordinary Markdown without frontmatter receives an index-only path-derived identity.

Save by ID updates only an existing live document. Otherwise, an explicit key resolves within the selected collection; without a key, create. Omitted update fields are preserved. Empty content/tags and null key explicitly clear them. Move collections through filesystem operations and reindexing.

## Storage

Each configuration owns its database connection and embedding worker. Default storage is isolated under ~/.mixgram/v2/. Collections cannot overlap. Existing version 1 databases are rejected before schema or journal changes; no migration is performed.

Write Markdown atomically by temporary file plus rename; report saved/indexed separately if the second step fails. The SQLite documents table contains derived metadata and the body. FTS5 indexes normalized title, headings and body. Full reindex rebuilds derived records from disk; incremental indexing detects content changes. Watch events use the same indexing function. Report invalid files and conflicts rather than silently accepting them.

## Retrieval

A shared SQL filter applies collection, type and all supplied tags to recent, text and semantic results. Recent listing orders by updated_at descending, then ID. Text uses FTS5 BM25. Optional embeddings run in a child process and store vectors associated with document content hashes and model names. Stale/deleted vectors do not match live documents.

Use exact cosine distance within eligible documents. Weighted reciprocal-rank fusion combines text and semantic ranks; deduplicate before limit/offset. Expose degradation when the semantic layer fails. This design deliberately trades approximate-nearest-neighbor scalability for complete filtered retrieval in a local memory corpus.

## Adapters and configuration

One tool registry defines MCP and CLI arguments and validation. CLI parsing preserves omitted fields. Domain functions return data; MCP handlers serialize results and mark errors, while the CLI prints the same JSON and sets failure exit codes.

Defaults are centralized in src/config.js. Merge nested file/environment/CLI overrides; replace collections as a complete map. Validate configuration before opening storage. No dependency changes or version 1 compatibility paths are part of this release.
