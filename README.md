# Mixgram 2

General-purpose memory for notes, documentation, research and agent knowledge. Markdown files are the source of truth; SQLite FTS5 and optional local embeddings provide search. Collections map names to folders, and tags classify documents across collections.

Version 2 uses a new API and fresh storage under `~/.mixgram/v2/`. It does not migrate version 1 data or expose Engram compatibility tools. Do not point it at an existing version 1 memory folder; legacy SQLite databases are rejected.

## Install and run

```bash
npm install -g mixgram
mixgram mcp
```

Client configuration:

```json
{
  "mcpServers": {
    "mixgram": { "command": "mixgram", "args": ["mcp"] }
  }
}
```

`mixgram setup cursor`, `mixgram setup gemini-cli` and `mixgram setup codex` register that command in the corresponding client config. `mixgram help` lists commands; `mixgram help mem_save` describes a tool's arguments.

## Six tools

| Tool | Arguments | Result |
|---|---|---|
| `mem_save` | Optional `id`, `collection`, `title`, `content`, `type`, `key`, `tags` | `id`, `path`, `created`, `saved`, `indexed` |
| `mem_search` | Optional `query`, `collection`, `type`, `tags`, `limit`, `offset` | `results`, `mode`, `degraded`, optional `reason` |
| `mem_get` | `id` | Metadata fields and separate `content` |
| `mem_delete` | `id`, optional `hardDelete` | Deletion and indexing status |
| `mem_stats` | None | Document counts, index location and embedding job status |
| `mem_reindex` | Optional `full` | `scanned`, `indexed`, `skipped`, `removed`, `errors` |

All tools are available through MCP and the CLI with the same validation. Invalid or unknown arguments produce errors. CLI failures return a nonzero exit code. MCP failures set `isError`. Tool responses contain JSON; protocol validation failures may contain SDK error text.

### Saving and updating

```bash
mixgram mem_save --title "Sourdough notes" --content "Feed the starter daily." --type recipe --tags baking
mixgram mem_save --collection research --key climate/method --title "Method" --content "Study notes"
mixgram mem_save --id DOCUMENT_ID --title "Revised title"
mixgram mem_save --id DOCUMENT_ID --content '' --no-tags
```

With `id`, update an existing live document; an unknown ID is an error. Without `id`, an explicit `key` upserts within the selected collection. Without either, create a new document even if its title matches another note. No key is automatically inferred from a title.

Omitted fields are preserved on updates. `content: ""` and `tags: []` clear those fields; `key: null` removes a key. CLI equivalents are `--content ''`, `--no-tags` and `--no-key`. Repeat `--tags value` to supply multiple tags. Defaults for new documents are empty title/content/tags, type `note`, and no key. Types are arbitrary nonempty strings.

New files use `<title-slug>-<id>.md`; updating a title retains the path. Collection changes are made by moving the file to another configured collection folder and reindexing. Updating an ID with a different collection is rejected.

Prompts and conversation summaries are ordinary documents. For example, use type `prompt` or `summary` and tag `conversation:123` to group a conversation.

### Search and listing

```bash
mixgram mem_search --query 'climate OR temperature' --collection research
mixgram mem_search --tags baking --type recipe --limit 5 --offset 0
mixgram mem_get --id DOCUMENT_ID
```

Without `query` (or with blank text), list recent documents by update time. With a query, use FTS5 syntax: quoted phrases and uppercase `AND`, `OR`, `NOT` are supported. Invalid FTS expressions return an error. Omit `collection` to search all configured collections. Every supplied tag must match. `limit` defaults to 10 and may not exceed `search.maxLimit` (100 by default); `offset` defaults to zero.

Results contain `id`, title, collection, type, key, tags, timestamps and a bounded snippet. Ranked results also contain a score. Read full content using `mem_get`.

When embeddings are enabled, ranks are fused using `weight / (fusionConstant + rank)`, then deduplicated and paginated. Text and semantic searches share collection/type/tag filters. Semantic search uses exact cosine distance over eligible vectors, so filtering cannot lose matches behind a global candidate limit. This favors correctness for a local memory corpus; vector retrieval and rank fusion scale with the matching corpus size.

Embeddings are optional at runtime. Model and native vector packages remain installed dependencies. The model runs in a child process; saves queue work and do not wait for model inference. Keep `mixgram mcp --embeddings` running to process queued documents, including saves made by one-off CLI commands. A one-off command does not wait for its entire embedding queue to drain. If the worker or vector store fails, search returns textual results with `degraded: true` and a reason. A healthy worker with no completed vectors yet may return only text matches in hybrid mode.

### Persistence and rebuilding

Frontmatter stores `id`, `title`, `type`, `key`, `tags`, `created_at`, `updated_at` and nullable `deleted_at`. Dates use UTC ISO 8601 strings. The body preserves its content, including empty content. Collection is derived from the configured root containing the file.

```bash
mixgram mem_reindex
mixgram mem_reindex --full
mixgram mem_delete --id DOCUMENT_ID
mixgram mem_delete --id DOCUMENT_ID --hardDelete
```

Save writes a temporary file and renames it before updating SQLite. If indexing fails afterwards, the response explicitly reports `saved: true`, `indexed: false`, and an error; the file is durable and reindexing repairs the index. Soft deletion persists `deleted_at` in Markdown and survives rebuilding; hard deletion removes the file, including a previously soft-deleted file.

Incremental reindexing compares file content hashes. Full reindexing reconstructs the text index from the configured folders. Both report errors per file. Metadata edited in Markdown takes precedence over SQLite. Plain Markdown without frontmatter is indexed using its first heading, file timestamps and a path-derived ID; to retain identity across moves, give the file an explicit `id` in frontmatter. Duplicate IDs, conflicting live keys and invalid metadata are reported as errors.

The watcher handles Markdown additions, changes and removals. Files outside configured roots, including symlinks pointing outside, are rejected. If the OS cannot provide native watches, Chokidar's `CHOKIDAR_USEPOLLING=1` environment setting selects polling.

## Configuration

Load order: defaults, config file, environment, CLI flags. Nested options merge; an explicitly supplied `collections` map replaces the default collection map. Relative config paths resolve from the config file's directory.

Default config locations are `./.mixgram/v2/config.json`, then `~/.mixgram/v2/config.json`. Select another file with `--config` or `MIXGRAM_CONFIG`. Version 1 config files are not loaded automatically.

```json
{
  "collections": {
    "general": "./general",
    "research": "./research"
  },
  "defaultCollection": "general",
  "sqlitePath": "./index.db",
  "watch": true,
  "embeddings": { "enabled": false }
}
```

Defaults: collection `general` at `~/.mixgram/v2/general`, index `~/.mixgram/v2/index.db`, watching and incremental startup synchronization enabled. Collection roots must not overlap, including through symlinks. `defaultCollection` must name a configured collection. Use a separate SQLite path for each distinct set of collections.

Environment: `MIXGRAM_CONFIG`, `MIXGRAM_SQLITE_PATH`, `MIXGRAM_EMBEDDINGS_ENABLED`, `MIXGRAM_WATCH`. Boolean values accept `1`, `0`, `true`, `false`. CLI overrides: `--config`, `--sqlite-path`, `--embeddings` / `--no-embeddings`, `--watch` / `--no-watch`.

Operational defaults live in `src/config.js`. Search weights default to 0.7 text / 0.3 semantic with fusion constant 60. The default embedding model is `Xenova/multilingual-e5-large`, 1024 dimensions, q8. Model output dimensions must match configuration. Embedding jobs retry up to three times; abandoned processing jobs become eligible after the configured five-minute lease (`embeddings.jobLeaseMs`). No silent configuration fallback is applied to invalid inputs.

## Development

Node.js with ESM; package manager `pnpm@11.3.0`. No build step is required.

```bash
npm test
npm run test:large
npm run quality
npm run bench:indexing
npm run bench:search
```

Tests use temporary folders and SQLite databases. Semantic ranking tests use real sqlite-vec distance calculations with deterministic vectors, without downloading a model. Optional model-backed runs: `npm run example:embedding`, `npm run bench:embed`, `npm run bench:search:embed`; these may download the model on first run.

## License

MIT
