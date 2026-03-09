/**
 * CLI adapter: parse argv into tool args using the tool registry's inputSchema,
 * and format help from descriptions/schemas. No duplicate tool definitions.
 */
import { getToolDefinitions, getToolByName } from './tool-registry.js';

/** Unwrap ZodOptional/ZodNullable to get inner type for CLI coercion and help. */
function unwrapZod(schema) {
  if (!schema || typeof schema !== 'object') return null;
  let s = schema;
  const optional = (s) => s?.constructor?.name === 'ZodOptional' || s?.constructor?.name === 'ZodNullable';
  while (s && optional(s)) {
    s = s._def?.innerType ?? s.unwrap?.() ?? null;
  }
  return s;
}

/** Return per-param meta: type ('string'|'number'|'boolean'|'array'), optional (boolean). */
function getParamMeta(inputSchema) {
  const meta = {};
  for (const key of Object.keys(inputSchema)) {
    const schema = inputSchema[key];
    const unwrapped = unwrapZod(schema);
    const optional = !unwrapped || (schema?.constructor?.name === 'ZodOptional' || schema?.constructor?.name === 'ZodNullable');
    let type = 'string';
    if (unwrapped) {
      const name = unwrapped.constructor?.name ?? '';
      if (name === 'ZodNumber') type = 'number';
      else if (name === 'ZodBoolean') type = 'boolean';
      else if (name === 'ZodArray') type = 'array';
    }
    meta[key] = { type, optional };
  }
  return meta;
}

/**
 * Parse argv (e.g. ['--query', 'foo', '--limit', '5', '--hardDelete']) into an object
 * matching the tool's inputSchema. Supports --key value, --flag (boolean true), --no-flag (boolean false),
 * and repeated --key v1 --key v2 for arrays.
 */
function parseToolArgs(toolDef, argv) {
  const meta = getParamMeta(toolDef.inputSchema);
  const result = {};
  const args = [...argv];

  for (const key of Object.keys(meta)) {
    if (meta[key].type === 'boolean') {
      result[key] = false;
    } else if (meta[key].type === 'array') {
      result[key] = [];
    }
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') continue;
    if (!a.startsWith('--')) continue;
    const isNegated = a.startsWith('--no-');
    const paramKey = isNegated ? a.slice(5) : a.slice(2);
    if (!Object.prototype.hasOwnProperty.call(meta, paramKey)) continue;
    const { type } = meta[paramKey];
    if (type === 'boolean') {
      result[paramKey] = !isNegated;
    } else if (type === 'array') {
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        result[paramKey].push(val);
        i++;
      }
    } else {
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        if (type === 'number') {
          const n = Number(val);
          result[paramKey] = Number.isNaN(n) ? val : n;
        } else {
          result[paramKey] = val;
        }
        i++;
      }
    }
  }

  for (const key of Object.keys(meta)) {
    if (result[key] === undefined && meta[key].optional) {
      if (meta[key].type === 'array') result[key] = [];
      else if (meta[key].type === 'boolean') result[key] = false;
    }
  }

  return result;
}

/** Format help text for a single tool (description + params). */
function formatToolHelp(toolDef) {
  const meta = getParamMeta(toolDef.inputSchema);
  const lines = [toolDef.description, '', 'Options:'];
  for (const [key, { type, optional }] of Object.entries(meta)) {
    const opt = optional ? ' (optional)' : '';
    if (type === 'boolean') {
      lines.push(`  --${key}    boolean${opt}`);
      lines.push(`  --no-${key}`);
    } else if (type === 'array') {
      lines.push(`  --${key} <value>  repeat for multiple${opt}`);
    } else {
      lines.push(`  --${key} <${type}>${opt}`);
    }
  }
  return lines.join('\n');
}

/** List tool names for main help. */
function listToolNames() {
  return getToolDefinitions().map((t) => t.name);
}

export { getToolDefinitions, getToolByName, getParamMeta, parseToolArgs, formatToolHelp, listToolNames };
