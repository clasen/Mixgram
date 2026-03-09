#!/usr/bin/env node
import { run } from './src/mcp/server.js';

run()
  .then(() => {})
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
