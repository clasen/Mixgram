#!/usr/bin/env node
/**
 * Mixgram CLI: mcp server and MCP auto-registration for clients.
 * Usage:
 *   mixgram mcp [options]    — run MCP server (stdio)
 *   mixgram setup <client>   — add Mixgram to Cursor / Gemini CLI / Codex config
 */
import { run } from '../src/mcp/server.js';
import { loadConfig } from '../src/config.js';
import { closeDb } from '../src/db/sqlite.js';
import { createToolHandlers } from '../src/mcp/tools.js';
import { getToolByName, listToolNames, parseToolArgs, formatToolHelp } from '../src/mcp/cli-adapter.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const SUBCOMMAND = process.argv[2];
const ARG = process.argv[3];

/** Parse options after "mcp": --config, --embeddings, --watch, --home, --sqlite-path */
function parseMcpArgs() {
  const args = process.argv.slice(3);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--embeddings') {
      out.embeddings = out.embeddings ?? {};
      out.embeddings.enabled = true;
    } else if (a === '--watch') {
      out.watch = true;
    } else if (a === '--config' && args[i + 1]) {
      out._configPath = args[++i];
    } else if (a === '--home' && args[i + 1]) {
      out.homeMemoryRoot = args[++i];
    } else if (a === '--project-memory' && args[i + 1]) {
      out.projectMemoryRoot = args[++i];
    } else if (a === '--sqlite-path' && args[i + 1]) {
      out.sqlitePath = args[++i];
    }
  }
  return out;
}

/** Resolve config file path: --config, MIXGRAM_CONFIG, ./.mixgram/config.json, ~/.mixgram/config.json */
function resolveConfigPath(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const envPath = process.env.MIXGRAM_CONFIG;
  if (envPath) return path.resolve(envPath);
  const cwd = process.cwd();
  const local = path.join(cwd, '.mixgram', 'config.json');
  if (fs.existsSync(local)) return local;
  const global = path.join(os.homedir(), '.mixgram', 'config.json');
  if (fs.existsSync(global)) return global;
  return null;
}

/** baseDir for path resolution: project root when config is in .mixgram/config.json, else config dir. */
function getBaseDir(configPath) {
  if (!configPath) return process.cwd();
  const dir = path.dirname(configPath);
  return path.basename(dir) === '.mixgram' ? path.dirname(dir) : dir;
}

/** Load config from file + env + argv. */
function loadCliConfig() {
  const argvOverrides = parseMcpArgs();
  const configPath = resolveConfigPath(argvOverrides._configPath);
  const baseDir = getBaseDir(configPath);

  let fileConfig = {};
  if (configPath) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('Could not read config from', configPath, e.message);
      process.exit(1);
    }
  }

  const envOverrides = {};
  if (process.env.MIXGRAM_EMBEDDINGS_ENABLED === '1' || process.env.MIXGRAM_EMBEDDINGS_ENABLED === 'true') {
    envOverrides.embeddings = { ...(fileConfig.embeddings || {}), enabled: true };
  }
  if (process.env.MIXGRAM_HOME) envOverrides.homeMemoryRoot = process.env.MIXGRAM_HOME;
  if (process.env.MIXGRAM_PROJECT_MEMORY) envOverrides.projectMemoryRoot = process.env.MIXGRAM_PROJECT_MEMORY;
  if (process.env.MIXGRAM_SQLITE_PATH) envOverrides.sqlitePath = process.env.MIXGRAM_SQLITE_PATH;
  if (process.env.MIXGRAM_WATCH === '1' || process.env.MIXGRAM_WATCH === 'true') envOverrides.watch = true;

  const { _configPath, ...argvRest } = argvOverrides;
  const merged = { ...fileConfig, ...envOverrides };
  Object.assign(merged, argvRest);
  if (argvRest.embeddings && typeof merged.embeddings === 'object') {
    merged.embeddings = { ...merged.embeddings, ...argvRest.embeddings };
  }
  const projectBaseDir = process.cwd();
  return { overrides: merged, baseDir, projectBaseDir };
}

const MIXGRAM_ENTRY = {
  command: 'mixgram',
  args: ['mcp']
};

const CURSOR_MIXGRAM_ENTRY = {
  command: 'mixgram',
  args: ['mcp', '--project-memory', '${workspaceFolder}/docs']
};

function cursorMcpPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'mcp.json');
  }
  if (process.platform === 'linux') {
    return path.join(home, '.config', 'cursor', 'mcp.json');
  }
  return path.join(home, '.cursor', 'mcp.json');
}

function geminiSettingsPath() {
  return path.join(os.homedir(), '.gemini', 'settings.json');
}

function codexConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml');
}

function setupCursor() {
  const filePath = cursorMcpPath();
  const dir = path.dirname(filePath);
  let data = { mcpServers: {} };
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('Could not parse existing Cursor mcp.json:', e.message);
      process.exit(1);
    }
    if (!data.mcpServers) data.mcpServers = {};
  } else {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('Could not create config directory:', e.message);
      process.exit(1);
    }
  }
  data.mcpServers.mixgram = CURSOR_MIXGRAM_ENTRY;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log('Cursor: added mixgram to', filePath);
  console.log('Restart Cursor to load the MCP server.');
}

function setupGeminiCli() {
  const filePath = geminiSettingsPath();
  const dir = path.dirname(filePath);
  let data = {};
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('Could not parse existing Gemini settings.json:', e.message);
      process.exit(1);
    }
  } else {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('Could not create .gemini directory:', e.message);
      process.exit(1);
    }
  }
  if (!data.mcpServers) data.mcpServers = {};
  data.mcpServers.mixgram = MIXGRAM_ENTRY;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log('Gemini CLI: added mixgram to', filePath);
}

function setupCodex() {
  const filePath = codexConfigPath();
  const dir = path.dirname(filePath);
  const section = `[mcp_servers.mixgram]
command = "mixgram"
args = ["mcp"]
`;
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
    const re = /\[mcp_servers\.mixgram\][\s\S]*?(?=\n\[|$)/;
    if (re.test(content)) {
      content = content.replace(re, section.trimEnd());
    } else {
      content = content.trimEnd() + '\n\n' + section;
    }
  } else {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('Could not create .codex directory:', e.message);
      process.exit(1);
    }
    content = section;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Codex: added mixgram to', filePath);
}

function printHelp() {
  const toolList = listToolNames();
  const toolLines = toolList.length ? `  ${toolList.join(', ')}\n\n` : '';
  console.log(`
Usage: mixgram <command> [options]

Commands:
  mcp [options]        Run the MCP server (stdio). Use this in your client config.
  setup <client>       Register Mixgram with an MCP client.
  flushdb              Delete the SQLite database file (and WAL/shm).
  help [tool]          Show help; with optional tool name, show options for that tool.
  -v, --version        Print version from package and exit.
  <tool> [options]     Run an MCP tool by name. Tools:
${toolLines}

mcp options (and env / config file):
  --config <path>      Config file (default: ./.mixgram/config.json or ~/.mixgram/config.json)
  --embeddings         Enable semantic search (or embeddings.enabled in config)
  --watch              Watch files and reindex on change
  --home <path>        Home memory root (default: ~/.mixgram/docs)
  --project-memory <path>  Project memory root (default: ./docs, relative to repo)
  --sqlite-path <path> SQLite index path (default: ~/.mixgram/index.db)

  Env: MIXGRAM_CONFIG, MIXGRAM_EMBEDDINGS_ENABLED, MIXGRAM_HOME, MIXGRAM_PROJECT_MEMORY,
       MIXGRAM_SQLITE_PATH, MIXGRAM_WATCH

Setup targets:
  cursor               Cursor IDE
  gemini-cli           Gemini CLI
  codex                Codex

Example (Cursor): "mixgram": { "command": "mixgram", "args": ["mcp", "--project-memory", "${workspaceFolder}/docs"] }
With embeddings:   "args": ["mcp", "--project-memory", "${workspaceFolder}/docs", "--embeddings"]
Config file:       .mixgram/config.json or ~/.mixgram/config.json

  npm install -g mixgram
`);
}

async function main() {
  if (SUBCOMMAND === '-v' || SUBCOMMAND === '--version') {
    console.log(PKG.version);
    return;
  }

  if (SUBCOMMAND === 'mcp') {
    const { overrides, baseDir, projectBaseDir } = loadCliConfig();
    await run(overrides, baseDir, projectBaseDir)
      .then(() => {})
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
    return;
  }

  if (SUBCOMMAND === 'flushdb') {
    const { overrides, baseDir, projectBaseDir } = loadCliConfig();
    const config = loadConfig(overrides, baseDir, projectBaseDir);
    const dbPath = config.sqlitePath;
    closeDb();
    const removed = [];
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        removed.push(p);
      }
    }
    if (removed.length) {
      console.log('Removed:', removed.join(', '));
    } else {
      console.log('No database file at', dbPath);
    }
    return;
  }

  if (SUBCOMMAND === 'setup') {
    if (!ARG) {
      console.error('Usage: mixgram setup <cursor|gemini-cli|codex>');
      process.exit(1);
    }
    switch (ARG) {
      case 'cursor':
        setupCursor();
        break;
      case 'gemini-cli':
        setupGeminiCli();
        break;
      case 'codex':
        setupCodex();
        break;
      default:
        console.error('Unknown target. Use: cursor, gemini-cli, or codex');
        process.exit(1);
    }
    return;
  }

  if (SUBCOMMAND === 'help' || SUBCOMMAND === '-h' || SUBCOMMAND === '--help' || !SUBCOMMAND) {
    if (ARG && getToolByName(ARG)) {
      console.log(formatToolHelp(getToolByName(ARG)));
    } else {
      printHelp();
    }
    return;
  }

  const toolNames = listToolNames();
  if (toolNames.includes(SUBCOMMAND)) {
    const toolArgv = process.argv.slice(3);
    if (toolArgv[0] === '--help' || toolArgv[0] === '-h') {
      console.log(formatToolHelp(getToolByName(SUBCOMMAND)));
      return;
    }
    const toolDef = getToolByName(SUBCOMMAND);
    const args = parseToolArgs(toolDef, toolArgv);
    const { overrides, baseDir, projectBaseDir } = loadCliConfig();
    const config = loadConfig(overrides, baseDir, projectBaseDir);
    const handlers = createToolHandlers(config);
    try {
      const result = await handlers[SUBCOMMAND](args);
      const text = result?.content?.[0]?.text;
      if (text != null) console.log(text);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
    return;
  }

  console.error('Unknown command:', SUBCOMMAND);
  printHelp();
  process.exit(1);
}

main();
