# Mixgram

MCP memory server compatible with [Engram](https://github.com/gentleman-programming/engram): **Markdown as source of truth**, SQLite FTS5 for full-text search. Optional local embeddings when you need hybrid search.

- **Human-readable memory** — All durable memory is stored as Markdown files.
- **Git-friendly** — Edit files by hand and reindex; the index is derived and rebuildable.
- **Engram-compatible** — Same MCP tool names and semantics; drop-in replacement.

### Advantages over Engram

- **Visible, editable docs** — As you advance with agentic development you see the actual documentation files on disk. You can open them, read them, and edit them manually; the agent’s memory is not hidden in a black box.
- **Versioned** — Memory lives in Markdown under your repo (e.g. `mixgram/<type>/` for project scope) or in a shared home (e.g. `home/memory/` for cross-project). Commit, branch, and diff as with any other docs.
- **No semantic deps required** — Core experience is text-only (FTS5). No need to install embeddings or vector libs unless you opt in.

---

## Installation

**Global install (recommended for MCP clients):**

```bash
npm install -g mixgram
```

Then use the `mixgram` command in your client config (see below). No extra dependencies for core (text-only) memory; embeddings are optional.

---

## CLI

| Command | Description |
|--------|-------------|
| `mixgram mcp [options]` | Run the MCP server (stdio). This is what your client runs. |
| `mixgram setup cursor` | Add Mixgram to Cursor’s MCP config. |
| `mixgram setup gemini-cli` | Add Mixgram to Gemini CLI settings. |
| `mixgram setup codex` | Add Mixgram to Codex config. |
| `mixgram help` | Show usage. |
| `mixgram help <tool>` | Show options for a specific MCP tool. |
| `mixgram <tool> [--key value ...]` | Run any MCP tool from the command line (see below). |

**MCP tools from the CLI** — Every MCP tool is automatically available as a subcommand. No extra wiring is needed: if a tool is added to the internal registry, it is exposed both to MCP clients and to the CLI. Use `mixgram help` to list tools and `mixgram help <tool>` (or `mixgram <tool> --help`) to see a tool’s options. Examples:

```bash
mixgram mem_stats
mixgram mem_search --query "index" --limit 5
mixgram mem_save --title "My note" --content "Body" --type decision --project my-app
mixgram mem_reindex --full
```

Arguments are passed as `--key value`. Booleans use `--flag` or `--no-flag`. Arrays use repeated flags: `--tags a --tags b`.

**`mcp` options** (and env / config file):

| Option | Env | Description |
|--------|-----|-------------|
| `--config <path>` | `MIXGRAM_CONFIG` | Config file (default: `./.mixgram/config.json` or `~/.mixgram/config.json`). |
| `--embeddings` | `MIXGRAM_EMBEDDINGS_ENABLED` | Enable optional semantic (hybrid) search. |
| `--watch` | `MIXGRAM_WATCH` | Watch files and reindex on change. |
| `--home <path>` | `MIXGRAM_HOME` | Home memory root (cross-project). |
| `--project-memory <path>` | `MIXGRAM_PROJECT_MEMORY` | Project memory root (default: `./mixgram`, relative to repo). |
| `--projects <path>` | `MIXGRAM_PROJECTS` | Projects root (legacy). |
| `--sqlite-path <path>` | `MIXGRAM_SQLITE_PATH` | SQLite index path. |

**Example — Cursor**

Add to Cursor’s MCP config (or run `mixgram setup cursor`):

```json
{
  "mcpServers": {
    "mixgram": {
      "command": "mixgram",
      "args": ["mcp"]
    }
  }
}
```

With embeddings and custom paths via args:

```json
"mixgram": {
  "command": "mixgram",
  "args": ["mcp", "--embeddings", "--home", "/data/memory", "--project-memory", "./specs"]
}
```

Or use `./mixgram` (default), `./docs`, or any path. Or use a config file (see below) and just `"args": ["mcp"]`. Restart Cursor after changing config.

---

## Quick start

Run the MCP server (stdio):

```bash
mixgram mcp
```

From the repo without global install: `npx mixgram mcp` or `npm start`. Configure your MCP client with `command: "mixgram"`, `args: ["mcp"]` when Mixgram is installed globally.

---

## Configuration

When you run `mixgram mcp`, config is merged from (lowest to highest priority):

1. **Defaults** (paths relative to current directory)
2. **Config file** — `./.mixgram/config.json` (project) or `~/.mixgram/config.json` (user), or `--config /path`
3. **Environment** — `MIXGRAM_*` (see table above)
4. **CLI args** — `--embeddings`, `--home`, etc.

Example **`.mixgram/config.json`** (project or home):

```json
{
  "homeMemoryRoot": "./home/memory",
  "projectMemoryRoot": "./mixgram",
  "sqlitePath": "./.mixgram/index.db",
  "watch": false,
  "embeddings": {
    "enabled": true
  }
}
```

Paths in the config file are relative to the config file’s directory (project) or to the current directory when using `~/.mixgram/config.json`. **Project memory** is resolved relative to the current working directory (repo) when you use a global config, so docs stay in the repo. The project memory folder name is configurable: set `projectMemoryRoot` to e.g. `./specs` to get `specs/architecture/`, `specs/decisions/`, etc. Defaults:

| Option | Default | Description |
|--------|---------|-------------|
| `homeMemoryRoot` | `./home/memory` | Cross-project memory (Markdown files). |
| `projectMemoryRoot` | `./mixgram` | Project memory in the current repo (e.g. `mixgram/architecture/`, `mixgram/decisions/`). You can use another folder name, e.g. `./specs` for `specs/architecture/`. |
| `sqlitePath` | `./.mixgram/index.db` | SQLite index (FTS5 + optional vectors). |
| `watch` | `false` | Watch files and reindex on change. |
| `indexing.reindexOnStartup` | `true` | Full reindex when server starts. |
| `embeddings.enabled` | `false` | Enable async local embeddings and hybrid search. |
| `search.defaultScopeMode` | `'merged'` | `'project-only'` \| `'home-only'` \| `'merged'`. |
| `search.ftsWeight` / `search.semanticWeight` | `0.7` / `0.3` | Weights when embeddings are enabled. |

Example minimal override:

```js
import { run } from 'mixgram/src/mcp/server.js';

await run({
  homeMemoryRoot: '/data/memory',
  projectMemoryRoot: '/path/to/repo/mixgram',
  sqlitePath: '/data/.mixgram/index.db',
  watch: true
});
```

---

## Text-only memory

Core flow: save Markdown-backed documents, search with FTS5, get context.

### Save (create or update by topic)

```json
// mem_save — create or update by topic_key
{
  "title": "Use SQLite as derived index",
  "type": "decision",
  "scope": "project",
  "project": "my-app",
  "topic_key": "architecture/sqlite-derived-index",
  "content": "SQLite will be the derived index over Markdown documents."
}
```

- **scope** `project` → file under `<repo>/mixgram/<type>/...` (e.g. `mixgram/architecture/`, `mixgram/decisions/`).
- **scope** `home` → file under `home/memory/...` (cross-project).
- Same `topic_key` + scope + project → **update** existing doc; otherwise create.

### Search

```json
// mem_search
{
  "query": "derived SQLite index",
  "scope_mode": "merged",
  "project": "my-app",
  "limit": 10
}
```

**scope_mode:**

- `project-only` — only project memory.
- `home-only` — only home memory.
- `merged` — both; project results ranked first when `project` is set.

Response includes `documentId`, `chunkId`, `title`, `topicKey`, `snippet`, `score`, etc.

### Context (for prompts)

```json
// mem_context — recent or query-based
{
  "query": "indexing decisions",
  "project": "my-app",
  "limit": 5
}
```

Omit `query` or use `*` to get **recent** context only.

### Get / update / delete

- **mem_get_observation** `{ "id": "<document-id>" }` — full document content.
- **mem_update** `{ "id": "<id>", "title": "...", "content": "..." }` — update by id.
- **mem_delete** `{ "id": "<id>", "hardDelete": false }` — soft or hard delete.

### Helpers

- **mem_suggest_topic_key** — suggest a stable `topic_key` from title/content/type.
- **mem_stats** — counts (documents, sessions, prompts, `embeddings_enabled`).

### Example: one round-trip

```text
1. mem_save → { success: true, id: "obs_...", path: "...", created: true }
2. mem_search({ query: "SQLite", project: "my-app" }) → { results: [ { title, snippet, ... } ] }
3. mem_get_observation({ id: "obs_..." }) → { title, content, type, scope, project, ... }
```

---

## Reindex, watch, and sessions

### Reindex from disk

Useful after cloning a repo or editing Markdown by hand:

```json
// mem_reindex
{ "full": true }
```

- `full: true` — rebuild entire index from `home/**/*.md` and `mixgram/**/*.md` (project memory in repo).
- `full: false` (default) — incremental (by mtime).

Manual edit example:

1. Edit a `.md` file under `home/memory` or `mixgram/<type>/` in your repo.
2. Call `mem_reindex({ full: true })` (or run with `watch: true` so changes are picked up).
3. `mem_search` and `mem_get_observation` reflect the new content.

### Watcher

Start the server with `watch: true` so that add/change/delete under the memory paths trigger reindex automatically.

### Sessions and prompts

- **mem_session_start** `{ "project": "my-app" }` → `{ session_id }`
- **mem_session_end** `{ "session_id": "..." }`
- **mem_session_summary** `{ "session_id": "...", "content": "...", "title": "..." }` — persists a summary as a memory document.
- **mem_save_prompt** `{ "session_id": "...", "content": "..." }` — store a prompt for the session.
- **mem_timeline** `{ "observation_id": "..." }` — before/focus/after in the same session.

### Scope examples

```json
// Only project memory
mem_search({ "query": "reindex", "scope_mode": "project-only", "project": "my-app" })

// Only home (cross-project)
mem_search({ "query": "reindex", "scope_mode": "home-only" })

// Both; project first
mem_search({ "query": "reindex", "scope_mode": "merged", "project": "my-app" })
```

---

## Optional semantic layer

When `embeddings.enabled` is `true` and the optional embedding stack is available:

- **Saves** are durable and searchable by text immediately; embeddings are queued and processed in the background.
- **Search** becomes **hybrid**: FTS + vector similarity, blended with `search.ftsWeight` and `search.semanticWeight` (e.g. 0.7 and 0.3).
- A **worker** runs in the background and processes the embedding queue (e.g. every 2 seconds).

### Enable embeddings

1. Ensure optional deps are installed if your setup uses them (e.g. `@huggingface/transformers`, `sqlite-vec`).
2. Configure:

```js
await run({
  embeddings: {
    enabled: true,
    similarityThreshold: 0.87,
    maxRetries: 3
  },
  search: {
    ftsWeight: 0.7,
    semanticWeight: 0.3
  }
});
```

### Behaviour

- **mem_save** / **mem_update** return as soon as the Markdown is written and the text index is updated; they do **not** wait for embeddings.
- **mem_search** uses FTS only until vectors exist for the matched chunks; then it uses the hybrid blend.
- If the embedding provider or sqlite-vec is unavailable, save and search still work (text-only).

### Example: hybrid search

```json
// Same tool; behaviour depends on config and whether vectors exist
mem_search({
  "query": "persistir índices derivados",
  "scope_mode": "merged",
  "project": "my-app",
  "limit": 5
})
```

With embeddings enabled and vectors ready, results combine literal matches (FTS) and semantic similarity (e.g. paraphrases).

---

## Tests

```bash
npm test
```

Runs black-box scenario tests for text-only memory, reindex/sessions/scope, and semantic fallback and error handling. Use `npm run test:visual` to see a narrative per scenario (inputs, outputs, snippets, and checks) for human review.

---

## License

MIT
