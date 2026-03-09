import { slugFromTopicKey } from '../fs/paths.js';
import { saveDocument, updateDocument, deleteDocument, getObservation, getObservationsBySession } from '../core/documents/documents.js';
import { search, getRecentContext } from '../core/search/search.js';
import { getDb } from '../db/sqlite.js';
import { startSession, endSession, getSession } from '../core/sessions/sessions.js';
import { savePrompt } from '../core/prompts/prompts.js';
import { fullReindex, incrementalReindex } from '../core/indexing/reindex.js';

const DOC_TYPES = ['architecture', 'decision', 'bug', 'learning', 'discovery', 'pattern', 'reference', 'session_summary', 'prompt', 'generated_note'];

function suggestTopicKey(title, content = '', type = 'generated_note') {
  const category = type && DOC_TYPES.includes(type) ? type : 'generated_note';
  const slug = slugFromTopicKey(title || content.slice(0, 80).trim());
  return `${category}/${slug}`;
}

function createToolHandlers(config) {
  return {
    mem_save: async (args) => {
      const result = saveDocument(config, {
        title: args.title,
        type: args.type || 'generated_note',
        scope: args.scope || 'project',
        project: args.project ?? null,
        topic_key: args.topic_key ?? null,
        content: args.content ?? '',
        session_id: args.session_id ?? null,
        id: args.id ?? null,
        tags: args.tags ?? []
      });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: result.id, path: result.path, created: result.created }) }] };
    },

    mem_update: async (args) => {
      const result = updateDocument(config, {
        id: args.id,
        title: args.title,
        content: args.content,
        tags: args.tags
      });
      if (!result) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Document not found' }) }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: result.id }) }] };
    },

    mem_delete: async (args) => {
      const ok = deleteDocument(config, args.id, { hardDelete: args.hardDelete === true });
      if (!ok) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Document not found' }) }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },

    mem_suggest_topic_key: async (args) => {
      const topicKey = suggestTopicKey(args.title, args.content, args.type);
      return { content: [{ type: 'text', text: JSON.stringify({ topic_key: topicKey }) }] };
    },

    mem_search: async (args) => {
      const results = await search(config, {
        query: args.query,
        scopeMode: args.scope_mode || config.search?.defaultScopeMode || 'merged',
        project: args.project ?? null,
        limit: args.limit ?? config.search?.defaultLimit ?? 10
      });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    },

    mem_context: async (args) => {
      const q = (args.query || '').trim();
      const results = q && q !== '*'
        ? await search(config, {
            query: q,
            scopeMode: 'merged',
            project: args.project ?? null,
            limit: args.limit ?? config.search?.defaultLimit ?? 10
          })
        : getRecentContext(config, { project: args.project ?? null, limit: args.limit ?? config.search?.defaultLimit ?? 10 });
      const context = results.map((r) => `[${r.title}] ${r.snippet}`).join('\n\n');
      return { content: [{ type: 'text', text: context || '(no context)' }] };
    },

    mem_get_observation: async (args) => {
      const obs = getObservation(config, args.id);
      if (!obs) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Observation not found' }) }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(obs) }] };
    },

    mem_stats: async () => {
      const db = getDb(config);
      const docs = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE deleted_at IS NULL").get();
      const sessions = db.prepare('SELECT COUNT(*) AS c FROM sessions').get();
      const prompts = db.prepare('SELECT COUNT(*) AS c FROM prompts').get();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            documents: docs?.c ?? 0,
            sessions: sessions?.c ?? 0,
            prompts: prompts?.c ?? 0,
            embeddings_enabled: config.embeddings?.enabled === true
          })
        }]
      };
    },

    mem_timeline: async (args) => {
      const focusId = args.observation_id;
      const obs = getObservation(config, focusId);
      if (!obs) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Observation not found' }) }], isError: true };
      const sessionId = obs.session_id;
      if (!sessionId) {
        return { content: [{ type: 'text', text: JSON.stringify({ before: [], focus: obs, after: [] }) }] };
      }
      const ids = getObservationsBySession(config, sessionId);
      const focusIndex = ids.indexOf(focusId);
      const before = focusIndex <= 0 ? [] : ids.slice(0, focusIndex).map((id) => getObservation(config, id)).filter(Boolean);
      const after = focusIndex < 0 || focusIndex >= ids.length - 1 ? [] : ids.slice(focusIndex + 1).map((id) => getObservation(config, id)).filter(Boolean);
      return { content: [{ type: 'text', text: JSON.stringify({ before, focus: obs, after }) }] };
    },

    mem_session_start: async (args) => {
      const result = startSession(config, { id: args.session_id ?? null, project: args.project ?? '', directory: args.directory ?? null });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, session_id: result.id, started_at: result.started_at }) }] };
    },

    mem_session_end: async (args) => {
      const result = endSession(config, args.session_id);
      return { content: [{ type: 'text', text: JSON.stringify({ success: result.success, ended_at: result.ended_at }) }] };
    },

    mem_session_summary: async (args) => {
      const session = getSession(config, args.session_id);
      if (!session) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Session not found' }) }], isError: true };
      const summaryContent = args.content ?? args.summary ?? '';
      saveDocument(config, {
        title: args.title ?? `Session summary ${args.session_id}`,
        type: 'session_summary',
        scope: 'project',
        project: session.project || null,
        topic_key: `sessions/summary-${args.session_id}`,
        content: summaryContent,
        session_id: args.session_id
      });
      getDb(config).prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summaryContent.slice(0, 2000), args.session_id);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },

    mem_save_prompt: async (args) => {
      const result = savePrompt(config, { session_id: args.session_id, project: args.project ?? null, content: args.content ?? '' });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, prompt_id: result.id }) }] };
    },

    mem_reindex: async (args) => {
      const full = args.full === true;
      const result = full ? fullReindex(config) : incrementalReindex(config);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  };
}

export { suggestTopicKey, createToolHandlers };
