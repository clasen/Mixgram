import { getToolDefinitions, getToolByName, validateToolArgs } from './tool-registry.js';

function getParamMeta(shape) {
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => {
    let inner = schema;
    while (inner._def.innerType) inner = inner._def.innerType;
    const type = inner._def.typeName.replace('Zod', '').toLowerCase();
    return [key, { type, optional: schema.isOptional(), nullable: schema.isNullable() }];
  }));
}

export function parseToolArgs(tool, argv) {
  const meta = getParamMeta(tool.inputSchema);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`Expected option, received ${flag}`);
    const negated = flag.startsWith('--no-');
    const key = flag.slice(negated ? 5 : 2);
    const field = meta[key];
    if (!field) throw new Error(`Unknown option: ${flag}`);
    if (field.type === 'boolean') { result[key] = !negated; continue; }
    if (negated && field.type === 'array') { result[key] = []; continue; }
    if (negated && field.nullable) { result[key] = null; continue; }
    if (negated) throw new Error(`Cannot negate ${key}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (field.type === 'array') (result[key] ??= []).push(value);
    else result[key] = field.type === 'number' ? Number(value) : value;
  }
  return validateToolArgs(tool.name, result);
}

export function formatToolHelp(tool) {
  return [tool.description, '', ...Object.entries(getParamMeta(tool.inputSchema)).map(([key, field]) =>
    `  --${key}${field.type === 'boolean' ? '' : ' <value>'}${field.optional ? ' (optional)' : ''}${field.type === 'array' ? '; repeat or --no-' + key + ' to clear' : field.nullable ? '; --no-' + key + ' to clear' : ''}`)].join('\n');
}

export function listToolNames() { return getToolDefinitions().map(tool => tool.name); }
export { getToolByName };
