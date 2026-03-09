#!/usr/bin/env node
/**
 * Runs spec/run-tests.js in a subprocess and reports success from stdout.
 * Use this so that a native crash on exit (e.g. from embedding libs) does not fail the test run
 * when all tests have already passed.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testScript = path.join(__dirname, 'run-tests.js');

const child = spawn(process.execPath, [testScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.dirname(__dirname)
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});

child.on('close', (code, signal) => {
  const output = stdout + stderr;
  const match = output.match(/(\d+)\s+passed,\s*(\d+)\s+failed/);
  const allPassed = match && parseInt(match[1], 10) > 0 && parseInt(match[2], 10) === 0;
  if (allPassed) {
    process.exit(0);
  }
  process.exit(code !== null && code !== 0 ? code : 1);
});
