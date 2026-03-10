import path from 'path';
import fs from 'fs';

const TYPE_TO_DIR = {
  architecture: 'architecture',
  decision: 'decisions',
  decisions: 'decisions',
  bug: 'bugs',
  bugs: 'bugs',
  learning: 'learnings',
  learnings: 'learnings',
  discovery: 'discoveries',
  discoveries: 'discoveries',
  pattern: 'patterns',
  patterns: 'patterns',
  reference: 'reference',
  session_summary: 'sessions',
  sessions: 'sessions',
  prompt: 'prompts',
  prompts: 'prompts',
  generated_note: 'generated',
  generated: 'generated'
};

function slugFromTopicKey(topicKey) {
  if (!topicKey || typeof topicKey !== 'string') return 'note';
  return topicKey
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '') || 'note';
}

function filenameSlugFromTopicKey(topicKey, { project = null, type = null } = {}) {
  if (!topicKey || typeof topicKey !== 'string') return 'note';

  const segments = topicKey
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) return 'note';

  const normalizedProject = slugFromTopicKey(project);
  if (normalizedProject !== 'note' && slugFromTopicKey(segments[0]) === normalizedProject) {
    segments.shift();
  }

  const typeDir = TYPE_TO_DIR[type] || 'generated';
  const redundantPrefixes = new Set([
    slugFromTopicKey(type),
    slugFromTopicKey(typeDir)
  ].filter((value) => value !== 'note'));

  if (segments.length > 1 && redundantPrefixes.has(slugFromTopicKey(segments[0]))) {
    segments.shift();
  }

  return slugFromTopicKey(segments.join('-'));
}

function documentPath(config, { scope, project, type, topic_key, id }) {
  const typeDir = TYPE_TO_DIR[type] || 'generated';
  const slug = filenameSlugFromTopicKey(topic_key, { project, type });
  const baseName = `${slug}.md`;

  if (scope === 'home') {
    const root = config.homeMemoryRoot;
    return path.join(root, typeDir, baseName);
  }

  if (scope === 'project') {
    const root = config.projectMemoryRoot;
    return path.join(root, typeDir, baseName);
  }

  const root = config.projectMemoryRoot;
  return path.join(root, typeDir, baseName);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function mixgramDir(config) {
  return path.dirname(config.sqlitePath);
}

function ensureMixgramDir(config) {
  const dir = mixgramDir(config);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export {
  documentPath,
  ensureDir,
  mixgramDir,
  ensureMixgramDir,
  TYPE_TO_DIR,
  slugFromTopicKey,
  filenameSlugFromTopicKey
};
