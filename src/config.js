import path from 'path';

const DEFAULT_CONFIG = {
  homeMemoryRoot: './home/memory',
  projectMemoryRoot: './mixgram',
  projectsRoot: './projects',
  sqlitePath: './.mixgram/index.db',
  watch: false,
  indexing: {
    chunkSize: 1200,
    chunkOverlap: 120,
    reindexOnStartup: true,
    ftsWeights: {
      title: 10.0,
      topicKey: 8.0,
      heading: 5.0,
      body: 1.0
    }
  },
  embeddings: {
    enabled: false,
    mode: 'optional',
    provider: 'local-huggingface',
    vectorStore: 'sqlite-vec',
    model: 'Xenova/multilingual-e5-large',
    dimensions: 1024,
    dtype: 'q8',
    workerConcurrency: 2,
    maxRetries: 3,
    queueOnWrite: true,
    similarityThreshold: 0.87
  },
  search: {
    mode: 'fts-only',
    defaultLimit: 10,
    ftsWeight: 0.7,
    semanticWeight: 0.3,
    defaultScopeMode: 'merged'
  }
};

function resolvePaths(config, baseDir, projectBaseDir = null) {
  const base = baseDir || process.cwd();
  const projectBase = projectBaseDir ?? base;
  return {
    ...config,
    homeMemoryRoot: path.resolve(base, config.homeMemoryRoot),
    projectMemoryRoot: path.resolve(projectBase, config.projectMemoryRoot ?? './mixgram'),
    projectsRoot: path.resolve(base, config.projectsRoot),
    sqlitePath: path.resolve(base, config.sqlitePath)
  };
}

function loadConfig(overrides = {}, baseDir, projectBaseDir = null) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  return resolvePaths(config, baseDir, projectBaseDir);
}

export { DEFAULT_CONFIG, loadConfig, resolvePaths };
