/**
 * Realistic corpus content for visual/scenario tests.
 * Used so humans can judge relevance, snippets, and ranking.
 */

export const PROJECT_NAME = 'castlebravo';

/** Architecture decision: SQLite as derived index */
export const decisionSqliteIndex = {
  title: 'Use SQLite as derived index',
  type: 'decision',
  scope: 'project',
  project: PROJECT_NAME,
  topic_key: 'architecture/sqlite-derived-index',
  content: `We use SQLite as a derived index over Markdown documents. The Markdown files under \`memory/\` are the source of truth; the SQLite database is rebuilt from them on reindex.

Benefits:
- Git-friendly: only Markdown is committed; the index can be recreated.
- Human-editable: memory can be fixed or extended by editing .md files.
- Fast full-text search via FTS5 and optional semantic search via sqlite-vec.`
};

/** Updated version of the same decision (revision two) */
export const decisionSqliteIndexRevision2 = {
  ...decisionSqliteIndex,
  content: `We use SQLite as the derived index over Markdown documents. Revision two: the index is rebuilt from disk on startup and on demand. Markdown remains the single source of truth.`
};

/** Home-scoped pattern: incremental reindexing */
export const patternIncrementalReindex = {
  scope: 'home',
  type: 'pattern',
  topic_key: 'pattern/incremental-reindexing',
  title: 'Incremental reindex',
  content: `Reindex only changed files. Use file mtime and content hash to skip unchanged documents. This keeps index updates fast when the corpus grows.`
};

/** Project-local pattern with same topic_key (must not overwrite home) */
export const patternIncrementalReindexProject = {
  title: 'Project local reindex',
  type: 'pattern',
  scope: 'project',
  project: PROJECT_NAME,
  topic_key: 'pattern/incremental-reindexing',
  content: 'Project-specific reindex note: we run incremental reindex after each batch of edits.'
};

/** Session summary content */
export const sessionSummaryContent = 'We decided to use SQLite for the index and to keep Markdown as source of truth. Next: add watch mode for live reindex.';

/** Prompt stored in session */
export const promptContent = 'User asked about indexing strategy and whether to use FTS5 or external search.';

/** Timeline: first and second note in same session */
export const timelineFirst = {
  title: 'First',
  type: 'decision',
  scope: 'project',
  project: PROJECT_NAME,
  topic_key: 'timeline/first',
  content: 'First note in this session: we agreed on SQLite.'
};

export const timelineSecond = {
  title: 'Second',
  type: 'decision',
  scope: 'project',
  project: PROJECT_NAME,
  topic_key: 'timeline/second',
  content: 'Second note: FTS5 will be used for full-text search; optional embeddings later.'
};

/** Content to inject by manual edit (reindex scenario) */
export const manualEditSnippet = 'Index is rebuilt from Markdown on reindex. Manual edits are reflected after reindex.';

/** Semantic test: Spanish doc about persistence */
export const semanticPersistenceDoc = {
  title: 'Persistencia y búsqueda',
  type: 'reference',
  scope: 'project',
  project: PROJECT_NAME,
  topic_key: 'test/persistencia-sqlite',
  content: 'Los datos se guardan en SQLite y la búsqueda es una forma de persistencia.'
};

/** Semantic query that should find the above (paraphrase) */
export const semanticPersistenceQuery = 'dónde se persisten los datos';

/** Semantic fallback test (FTS when embeddings enabled) */
export const semanticFallbackDoc = {
  title: 'Semantic test doc',
  type: 'generated_note',
  scope: 'project',
  project: PROJECT_NAME,
  topic_key: 'test/semantic-fallback',
  content: 'Text for semantic fallback test.'
};

/** Used to test FTS5 OR query: save then search with "mcp OR \"model context protocol\"" */
export const noteMcpArchitecture = {
  title: 'Other note',
  type: 'architecture',
  content: 'Model Context Protocol',
  scope: 'project',
  project: null
};
