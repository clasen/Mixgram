/**
 * Visual console reporter for scenario tests.
 * Prints scenario name, goal, inputs, outputs, and PASS/FAIL so humans can evaluate behavior.
 */

const VISUAL = process.argv.includes('--visual');

function out(...args) {
  if (VISUAL) console.log(...args);
}

function dim(msg) {
  if (!VISUAL) return;
  console.log('\x1b[2m%s\x1b[0m', msg);
}

function green(msg) {
  if (!VISUAL) return;
  console.log('\x1b[32m%s\x1b[0m', msg);
}

function red(msg) {
  if (!VISUAL) return;
  console.log('\x1b[31m%s\x1b[0m', msg);
}

/**
 * Pretty-print a small object for console (one line or few lines).
 */
function preview(obj, maxLen = 200) {
  if (obj === null || obj === undefined) return String(obj);
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

/**
 * Start a scenario block.
 * @param {string} name
 * @param {string} goal
 */
function startScenario(name, goal) {
  if (!VISUAL) return;
  console.log('');
  console.log('━━━ %s ━━━', name);
  dim('Goal: ' + goal);
  console.log('');
}

/**
 * Print a step: label + optional input/output.
 * @param {string} label - e.g. "mem_save", "mem_search"
 * @param {object} [input] - args sent to the tool
 * @param {object} [output] - parsed result (or key fields)
 * @param {{ highlight?: string[] }} [opts] - keys to highlight from output (e.g. ['snippet', 'score', 'path'])
 */
function step(label, input, output, opts = {}) {
  if (!VISUAL) return;
  dim('  → ' + label);
  if (input != null) dim('    in: ' + preview(input));
  if (output != null) {
    if (opts.highlight && Array.isArray(output)) {
      output.slice(0, 3).forEach((r, i) => {
        const parts = opts.highlight.map((k) => (r[k] != null ? `${k}=${preview(String(r[k]), 80)}` : '')).filter(Boolean);
        dim('    out[' + i + ']: ' + parts.join(' | '));
      });
      if (output.length > 3) dim('    ... and ' + (output.length - 3) + ' more');
    } else if (typeof output === 'object' && output.results) {
      output.results.slice(0, 3).forEach((r, i) => {
        const parts = ['title', 'snippet', 'score', 'scope'].filter((k) => r[k] != null).map((k) => `${k}=${preview(String(r[k]), 60)}`);
        dim('    result[' + i + ']: ' + parts.join(' | '));
      });
      if (output.results.length > 3) dim('    ... and ' + (output.results.length - 3) + ' more');
    } else {
      dim('    out: ' + preview(output));
    }
  }
}

/**
 * Print a single check result.
 * @param {string} label
 * @param {boolean} passed
 * @param {string} [detail] - optional extra info
 */
function check(label, passed, detail) {
  if (!VISUAL) return;
  if (passed) green('  ✓ ' + label);
  else red('  ✗ ' + label + (detail ? ': ' + detail : ''));
}

/**
 * End scenario with passed/failed counts.
 */
function endScenario(passedCount, failedCount) {
  if (!VISUAL) return;
  if (failedCount === 0) green('  Scenario: ' + passedCount + ' passed');
  else red('  Scenario: ' + passedCount + ' passed, ' + failedCount + ' failed');
  console.log('');
}

/**
 * Print final summary (always).
 */
function summary(totalPassed, totalFailed) {
  const msg = 'Total: ' + totalPassed + ' passed, ' + totalFailed + ' failed';
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (totalFailed === 0) {
    if (VISUAL) green(msg);
    else console.log(msg);
  } else {
    if (VISUAL) red(msg);
    else console.error(msg);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

export {
  startScenario,
  step,
  check,
  endScenario,
  summary,
  preview,
  VISUAL
};
