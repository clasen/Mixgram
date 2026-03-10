import matter from 'gray-matter';

export const FRONTMATTER_KEYS = [
  'id', 'title', 'type', 'scope', 'project', 'topic_key', 'session_id', 'tool_name',
  'created_at', 'updated_at', 'revision_count', 'duplicate_count', 'deleted', 'tags',
  'embedding_status', 'indexed_at', 'deleted_at'
];

/** Keys written to .md: id, type, title, created (cosmetic). scope/project stay in DB only; reindex infers scope from path. */
const DISPLAY_FRONTMATTER_KEYS = ['id', 'type', 'title', 'created'];

function formatCreated(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return createdAt;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function parseCreated(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function serializeFrontmatter(fm) {
  const obj = {};
  for (const k of FRONTMATTER_KEYS) {
    if (fm[k] !== undefined && fm[k] !== null && fm[k] !== '') {
      obj[k] = fm[k];
    }
  }
  return obj;
}

/** Minimal frontmatter for .md (cosmetic only; deleted flag for soft-delete visibility). */
function serializeDisplayFrontmatter(fm) {
  const obj = {};
  for (const k of DISPLAY_FRONTMATTER_KEYS) {
    if (k === 'created') {
      const raw = fm.created_at ?? (fm.created ? parseCreated(fm.created) : null);
      const v = raw ? formatCreated(raw) : null;
      if (v) obj[k] = v;
    } else if (fm[k] !== undefined && fm[k] !== null && fm[k] !== '') {
      obj[k] = fm[k];
    }
  }
  if (fm.deleted_at) obj.deleted_at = fm.deleted_at;
  if (fm.deleted === true) obj.deleted = true;
  return obj;
}

export function parse(content) {
  const parsed = matter(content);
  const data = parsed.data || {};
  const createdAt = data.created_at ?? parseCreated(data.created);
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
      created_at: createdAt,
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
  const fm = serializeDisplayFrontmatter(frontmatter);
  return matter.stringify(body || '', fm, { lineWidth: -1 });
}
