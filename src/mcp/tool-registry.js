/**
 * Shared MCP tool registry: single source of truth for name, description, and inputSchema.
 * Used by the MCP server (registration) and CLI (subcommands and help).
 */
import { z } from 'zod';

const optionalString = z.string().optional();
const optionalNumber = z.number().optional();
const optionalBoolean = z.boolean().optional();
const optionalArray = z.array(z.string()).optional();

/** Tool definitions: name, description, inputSchema (Zod shape). Handlers live in tools.js. */
const TOOL_DEFINITIONS = [
  {
    name: 'mem_save',
    description: 'Save a memory document (create or update by topic_key)',
    inputSchema: {
      title: optionalString,
      type: optionalString,
      scope: optionalString,
      project: optionalString.nullable(),
      topic_key: optionalString.nullable(),
      content: optionalString,
      session_id: optionalString.nullable(),
      id: optionalString.nullable(),
      tags: optionalArray
    }
  },
  {
    name: 'mem_update',
    description: 'Update an existing document by id',
    inputSchema: {
      id: z.string(),
      title: optionalString,
      content: optionalString,
      tags: optionalArray
    }
  },
  {
    name: 'mem_delete',
    description: 'Soft or hard delete a document by id',
    inputSchema: {
      id: z.string(),
      hardDelete: optionalBoolean
    }
  },
  {
    name: 'mem_suggest_topic_key',
    description: 'Suggest a stable topic key from title/content/type',
    inputSchema: {
      title: optionalString,
      content: optionalString,
      type: optionalString
    }
  },
  {
    name: 'mem_search',
    description: 'Full-text search over memory (project-only, home-only, or merged)',
    inputSchema: {
      query: z.string(),
      scope_mode: optionalString,
      project: optionalString.nullable(),
      limit: optionalNumber
    }
  },
  {
    name: 'mem_context',
    description: 'Get contextual memory for a project (recent or search-based)',
    inputSchema: {
      query: optionalString,
      project: optionalString.nullable(),
      limit: optionalNumber
    }
  },
  {
    name: 'mem_get_observation',
    description: 'Get full document content by id',
    inputSchema: { id: z.string() }
  },
  {
    name: 'mem_stats',
    description: 'Get memory statistics (documents, sessions, prompts)',
    inputSchema: {}
  },
  {
    name: 'mem_timeline',
    description: 'Get before/focus/after observations for an observation in its session',
    inputSchema: { observation_id: z.string() }
  },
  {
    name: 'mem_session_start',
    description: 'Start a new session',
    inputSchema: {
      session_id: optionalString.nullable(),
      project: optionalString.nullable(),
      directory: optionalString.nullable()
    }
  },
  {
    name: 'mem_session_end',
    description: 'End a session',
    inputSchema: { session_id: z.string() }
  },
  {
    name: 'mem_session_summary',
    description: 'Persist a session summary as durable memory',
    inputSchema: {
      session_id: z.string(),
      content: optionalString,
      summary: optionalString,
      title: optionalString
    }
  },
  {
    name: 'mem_save_prompt',
    description: 'Store a prompt for a session (no Markdown file by default)',
    inputSchema: {
      session_id: z.string(),
      project: optionalString.nullable(),
      content: optionalString
    }
  },
  {
    name: 'mem_reindex',
    description: 'Run full or incremental reindex from Markdown files',
    inputSchema: { full: optionalBoolean }
  }
];

function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

function getToolByName(name) {
  return TOOL_DEFINITIONS.find((t) => t.name === name) ?? null;
}

export { getToolDefinitions, getToolByName, TOOL_DEFINITIONS };
