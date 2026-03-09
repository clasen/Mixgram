import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { createToolHandlers } from './tools.js';
import { getToolDefinitions } from './tool-registry.js';

function createServer(configOverrides = {}, baseDir = null, projectBaseDir = null) {
  const config = loadConfig(configOverrides, baseDir, projectBaseDir);
  const mcpServer = new McpServer(
    { name: 'mixgram', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } }
  );

  const handlers = createToolHandlers(config);
  const definitions = getToolDefinitions();

  for (const def of definitions) {
    const handler = handlers[def.name];
    if (!handler) continue;
    mcpServer.registerTool(def.name, {
      description: def.description,
      inputSchema: def.inputSchema
    }, async (args) => handler(args));
  }

  return { mcpServer, config };
}

async function run(configOverrides = {}, baseDir = null, projectBaseDir = null) {
  if (typeof process !== 'undefined') {
    process.on('unhandledRejection', (reason, promise) => {
      if (process.stderr) {
        process.stderr.write(`[mixgram] unhandledRejection: ${reason}\n`);
      }
    });
  }

  const { mcpServer, config } = createServer(configOverrides, baseDir, projectBaseDir);

  if (config.indexing?.reindexOnStartup) {
    try {
      const { fullReindex } = await import('../core/indexing/reindex.js');
      fullReindex(config);
    } catch (err) {
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[mixgram] reindex on startup failed: ${err?.message ?? err}\n`);
      }
    }
  }
  if (config.watch) {
    try {
      const { startWatcher } = await import('../fs/watcher.js');
      startWatcher(config);
    } catch (err) {
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[mixgram] watcher start failed: ${err?.message ?? err}\n`);
      }
    }
  }
  if (config.embeddings?.enabled) {
    try {
      const { startWorker } = await import('../core/embeddings/worker.js');
      startWorker(config);
    } catch (err) {
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[mixgram] embeddings worker start failed: ${err?.message ?? err}\n`);
      }
    }
  }
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

export { createServer, run };
