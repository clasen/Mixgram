import path from 'path';
import os from 'os';

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2) || '');
  }
  return p;
}

const DEFAULT_CONFIG = {
  homeMemoryRoot: '~/.mixgram/docs',
  projectMemoryRoot: './docs',
  sqlitePath: '~/.mixgram/index.db',
  watch: true,
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
  const homeRoot = expandHome(config.homeMemoryRoot);
  const sqlite = expandHome(config.sqlitePath);
  return {
    ...config,
    homeMemoryRoot: path.isAbsolute(homeRoot) ? homeRoot : path.resolve(base, homeRoot),
    projectMemoryRoot: path.resolve(projectBase, config.projectMemoryRoot ?? './mixgram'),
    sqlitePath: path.isAbsolute(sqlite) ? sqlite : path.resolve(base, sqlite)
  };
}

function loadConfig(overrides = {}, baseDir, projectBaseDir = null) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  return resolvePaths(config, baseDir, projectBaseDir);
}

export { DEFAULT_CONFIG, loadConfig, resolvePaths };
