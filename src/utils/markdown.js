import matter from 'gray-matter';

export const FRONTMATTER_KEYS = [
  'id', 'title', 'type', 'scope', 'project', 'topic_key', 'session_id', 'tool_name',
  'created_at', 'updated_at', 'revision_count', 'duplicate_count', 'deleted', 'tags',
  'embedding_status', 'indexed_at', 'deleted_at'
];

function serializeFrontmatter(fm) {
  const obj = {};
  for (const k of FRONTMATTER_KEYS) {
    if (fm[k] !== undefined && fm[k] !== null && fm[k] !== '') {
      obj[k] = fm[k];
    }
  }
  return obj;
}

export function parse(content) {
  const parsed = matter(content);
  const data = parsed.data || {};
  return {
    frontmatter: {
      id: data.id,
      title: data.title,
      type: data.type || 'generated_note',
      scope: data.scope || 'project',
      project: data.project,
      topic_key: data.topic_key,
      session_id: data.session_id,
      tool_name: data.tool_name,
      created_at: data.created_at,
      updated_at: data.updated_at,
      revision_count: data.revision_count ?? 1,
      duplicate_count: data.duplicate_count ?? 0,
      deleted: data.deleted === true,
      tags: Array.isArray(data.tags) ? data.tags : [],
      embedding_status: data.embedding_status || 'disabled',
      indexed_at: data.indexed_at,
      deleted_at: data.deleted_at
    },
    body: parsed.content ? parsed.content.trim() : ''
  };
}

export function toMarkdown(frontmatter, body) {
  const fm = serializeFrontmatter(frontmatter);
  return matter.stringify(body || '', fm, { lineWidth: -1 });
}
