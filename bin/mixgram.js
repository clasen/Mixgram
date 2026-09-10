#!/usr/bin/env node
/**
 * Mixgram CLI: mcp server and MCP auto-registration for clients.
 * Usage:
 *   mixgram mcp [options]    — run MCP server (stdio)
 *   mixgram setup <client>   — add Mixgram to Cursor / Gemini CLI / Codex config
 */
import { run, startEmbeddingWorker } from '../src/mcp/server.js';
import { loadConfig, mergeConfig } from '../src/config.js';
import { closeDb } from '../src/db/sqlite.js';
import { createToolHandlers } from '../src/mcp/tools.js';
import { getToolByName, listToolNames, parseToolArgs, formatToolHelp } from '../src/mcp/cli-adapter.js';
import { reindex } from '../src/core/indexing/reindex.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const SUBCOMMAND = process.argv[2];
const ARG = process.argv[3];

function loadCliConfig(argv = process.argv.slice(3)) {
  const overrides = {};
  const toolArgs = [];
  let explicitPath;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--embeddings', '--no-embeddings'].includes(flag)) overrides.embeddings = { enabled: flag === '--embeddings' };
    else if (['--watch', '--no-watch'].includes(flag)) overrides.watch = flag === '--watch';
    else if (['--config', '--sqlite-path'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--config') explicitPath = path.resolve(value); else overrides.sqlitePath = path.resolve(value);
    } else toolArgs.push(flag);
  }
  const candidates = [path.resolve('.mixgram/v2/config.json'), path.join(os.homedir(), '.mixgram/v2/config.json')];
  const configPath = explicitPath ?? process.env.MIXGRAM_CONFIG ?? candidates.find(p => fs.existsSync(p));
  const file = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const env = {};
  for (const [variable, key] of [['MIXGRAM_WATCH', 'watch'], ['MIXGRAM_EMBEDDINGS_ENABLED', 'embeddings']]) {
    const value = process.env[variable];
    if (value === undefined) continue;
    if (!['1','0','true','false'].includes(value)) throw new Error(`Invalid boolean for ${variable}`);
    const enabled = value === '1' || value === 'true';
    env[key] = key === 'embeddings' ? { enabled } : enabled;
  }
  if (process.env.MIXGRAM_SQLITE_PATH) env.sqlitePath = path.resolve(process.env.MIXGRAM_SQLITE_PATH);
  return { overrides: mergeConfig(file, env, overrides), baseDir: configPath ? path.dirname(path.resolve(configPath)) : process.cwd(), toolArgs };
}

const MIXGRAM_ENTRY = {
  command: 'mixgram',
  args: ['mcp']
};

const CURSOR_MIXGRAM_ENTRY = {
  command: 'mixgram',
  args: ['mcp']
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
  console.log(`Usage: mixgram <command> [options]
Commands: mcp, setup <cursor|gemini-cli|codex>, help [tool], --version
Tools: ${listToolNames().join(', ')}
Options: --config <path>, --sqlite-path <path>, --embeddings / --no-embeddings, --watch / --no-watch
Default config: .mixgram/v2/config.json or ~/.mixgram/v2/config.json
Environment: MIXGRAM_CONFIG, MIXGRAM_SQLITE_PATH, MIXGRAM_EMBEDDINGS_ENABLED, MIXGRAM_WATCH
Configure collections and defaultCollection in the config file.`);
}

async function main() {
  if (SUBCOMMAND === '-v' || SUBCOMMAND === '--version') {
    console.log(PKG.version);
    return;
  }

  if (SUBCOMMAND === 'mcp') {
    const { overrides, baseDir, toolArgs } = loadCliConfig();
    if (toolArgs.length) throw new Error(`Unknown options: ${toolArgs.join(' ')}`);
    await run(overrides, baseDir)
      .then(() => {})
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
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
    const { overrides, baseDir, toolArgs } = loadCliConfig();
    const args = parseToolArgs(toolDef, toolArgs);
    const config = loadConfig(overrides, baseDir);
    const cleanupWorker = startEmbeddingWorker(config);
    try {
      if (config.indexing.reindexOnStartup && SUBCOMMAND !== 'mem_reindex') {
        const sync = reindex(config);
        for (const error of sync.errors) console.error(`${error.path}: ${error.error}`);
      }
      const result = await createToolHandlers(config)[SUBCOMMAND](args);
      console.log(result.content[0].text);
      if (result.isError) process.exitCode = 1;
    } finally {
      cleanupWorker();
      closeDb(config);
    }
    return;
  }

  console.error('Unknown command:', SUBCOMMAND);
  printHelp();
  process.exit(1);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
