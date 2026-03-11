/**
 * User-facing scenario definitions for Mixgram tests.
 * Each scenario has name, goal, and run(ctx). run() returns { passed, failed }.
 * ctx: { h, parse, config, fs, reporter, ok } where ok(cond, msg) counts and optionally prints check.
 */

import path from 'path';

import {
  decisionSqliteIndex,
  decisionSqliteIndexRevision2,
  patternIncrementalReindex,
  patternIncrementalReindexProject,
  sessionSummaryContent,
  promptContent,
  timelineFirst,
  timelineSecond,
  manualEditSnippet,
  semanticPersistenceDoc,
  semanticPersistenceQuery,
  semanticFallbackDoc,
  noteMcpArchitecture,
  PROJECT_NAME
} from '../fixtures/realistic-content.js';
import { toMarkdown } from '../../src/utils/markdown.js';

function parse(res) {
  return JSON.parse(res.content[0].text);
}

export const scenarios = [
  {
    name: 'Save and find a project decision',
    goal: 'Save a project-scoped decision, then find it via search and get_observation.',
    run: async function (ctx) {
      const { h, reporter, fs } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const save1 = await h.mem_save(decisionSqliteIndex);
      const s1 = parseRes(save1);
      ctx.shared = ctx.shared || {};
      ctx.shared.decisionDoc = s1;
      reporter.step('mem_save', { title: decisionSqliteIndex.title, topic_key: decisionSqliteIndex.topic_key }, { id: s1.id, path: s1.path, created: s1.created });
      ok(s1.success && s1.id && s1.created === true, 'save success');
      ok(fs.existsSync(s1.path), 'file created');
      ok(s1.path.includes('docs') || s1.path.replace(/\\/g, '/').includes('docs'), 'project doc under project memory root');
      ok(path.basename(s1.path) === 'architecture-sqlite-derived-index.md', 'project doc filename omits redundant prefixes');

      const search1 = await h.mem_search({ query: 'derived SQLite index', project: PROJECT_NAME });
      const search1Parsed = parseRes(search1);
      reporter.step('mem_search', { query: 'derived SQLite index', project: PROJECT_NAME }, search1Parsed, { highlight: ['title', 'snippet', 'score'] });
      ok(search1Parsed.results.length >= 1, 'searchable');

      const obs1 = await h.mem_get_observation({ id: s1.id });
      const obs1Parsed = parseRes(obs1);
      reporter.step('mem_get_observation', { id: s1.id }, { title: obs1Parsed.title });
      ok(obs1Parsed.title === decisionSqliteIndex.title, 'get_observation title');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Home-scoped memory and merged search',
    goal: 'Save a home-scoped pattern and find it in merged project search.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const save2 = await h.mem_save(patternIncrementalReindex);
      const s2 = parseRes(save2);
      reporter.step('mem_save (home)', { scope: 'home', topic_key: patternIncrementalReindex.topic_key }, { path: s2.path, created: s2.created });
      ok(s2.success && s2.path && s2.path.includes('home'), 'home save');
      ok(path.basename(s2.path) === 'incremental-reindexing.md', 'home doc filename omits folder category');

      const searchMerged = await h.mem_search({ query: 'reindex', scope_mode: 'merged', project: PROJECT_NAME });
      const mergedParsed = parseRes(searchMerged);
      reporter.step('mem_search (merged)', { query: 'reindex', scope_mode: 'merged' }, mergedParsed, { highlight: ['title', 'scope', 'snippet'] });
      ok(mergedParsed.results.length >= 1, 'merged search');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Update by topic_key (upsert)',
    goal: 'Saving again with same topic_key updates the document instead of creating a duplicate.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };
      if (!ctx.shared?.decisionDoc) {
        const save1 = await h.mem_save(decisionSqliteIndex);
        ctx.shared = ctx.shared || {};
        ctx.shared.decisionDoc = parseRes(save1);
      }

      reporter.startScenario(this.name, this.goal);

      const save3 = await h.mem_save(decisionSqliteIndexRevision2);
      const s3 = parseRes(save3);
      reporter.step('mem_save (same topic_key)', { topic_key: decisionSqliteIndexRevision2.topic_key }, { id: s3.id, created: s3.created });
      ok(s3.success && s3.created === false, 'update not create');

      const obs3 = await h.mem_get_observation({ id: s3.id });
      const obs3Parsed = parseRes(obs3);
      reporter.step('mem_get_observation', {}, { contentPreview: (obs3Parsed.content || '').slice(0, 100) });
      ok(obs3Parsed.content && obs3Parsed.content.includes('Revision two'), 'updated content');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Update document by id',
    goal: 'mem_update by id changes title and content.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };
      const s1 = ctx.shared?.decisionDoc || parseRes(await h.mem_save(decisionSqliteIndex));
      if (!ctx.shared) ctx.shared = { decisionDoc: s1 }; else ctx.shared.decisionDoc = s1;

      reporter.startScenario(this.name, this.goal);

      const upd = await h.mem_update({ id: s1.id, title: 'Updated title', content: 'Updated body.' });
      const updParsed = parseRes(upd);
      reporter.step('mem_update', { id: s1.id, title: 'Updated title' }, updParsed);
      ok(updParsed.success, 'update success');

      const obs4 = await h.mem_get_observation({ id: s1.id });
      const obs4Parsed = parseRes(obs4);
      reporter.step('mem_get_observation', {}, { title: obs4Parsed.title, contentPreview: (obs4Parsed.content || '').slice(0, 50) });
      ok(obs4Parsed.title === 'Updated title' && obs4Parsed.content && obs4Parsed.content.includes('Updated body'), 'content updated');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Search returns results with snippets',
    goal: 'mem_search returns an array of results with title, snippet, score.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const search2 = await h.mem_search({ query: 'updated body', project: PROJECT_NAME, limit: 5 });
      const res = parseRes(search2).results;
      reporter.step('mem_search', { query: 'updated body', limit: 5 }, { results: res }, { highlight: ['title', 'snippet', 'score'] });
      ok(Array.isArray(res), 'results array');
      ok(res.length >= 1, 'has results');
      ok(res.length === 0 || res[0].snippet != null, 'snippets present');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Search with hyphen and slash in query (FTS5 sanitization)',
    goal: 'mem_search does not throw on queries containing "-" or "/" (no "syntax error near /" or "no such column").',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const queries = ['sdd-init', 'sdd-init/alchemy-tycoon', 'alchemy-tycoon sdd-init'];
      for (const query of queries) {
        let res;
        try {
          res = await h.mem_search({ query, project: PROJECT_NAME, limit: 5 });
        } catch (e) {
          reporter.check(`mem_search("${query}") does not throw`, false);
          f++;
          reporter.endScenario(p, f);
          return { passed: p, failed: f };
        }
        const data = parseRes(res).results;
        ok(Array.isArray(data), `mem_search("${query}") returns array`);
      }

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Search with OR query (FTS5 operator case)',
    goal: 'mem_save then mem_search with query using OR (e.g. mcp OR "model context protocol") returns the saved document.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const saveRes = await h.mem_save(noteMcpArchitecture);
      const saveData = parseRes(saveRes);
      reporter.step('mem_save', { title: noteMcpArchitecture.title, type: noteMcpArchitecture.type }, { id: saveData.id, created: saveData.created });
      ok(saveData.success && saveData.id, 'mem_save success');

      const searchRes = await h.mem_search({ query: 'mcp OR "model context protocol"', limit: 10 });
      const searchData = parseRes(searchRes);
      reporter.step('mem_search', { query: 'mcp OR "model context protocol"' }, searchData, { highlight: ['title', 'snippet'] });
      ok(Array.isArray(searchData.results), 'results is array');
      ok(searchData.results.length >= 1, 'OR query returns at least one result');
      const found = searchData.results.some(
        (r) => (r.title && r.title.includes('Other note')) || (r.snippet && (r.snippet.toLowerCase().includes('mcp') || r.snippet.toLowerCase().includes('model context protocol')))
      );
      ok(found, 'saved note is in OR query results');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Context for project',
    goal: 'mem_context returns usable context (recent or query-based).',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const ctxRes = await h.mem_context({ project: PROJECT_NAME, limit: 5 });
      const text = ctxRes.content[0].text;
      reporter.step('mem_context', { project: PROJECT_NAME, limit: 5 }, text?.slice(0, 300) || '(empty)');
      ok(typeof text === 'string' && text.length >= 0, 'mem_context returns text');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Stats',
    goal: 'mem_stats returns document/session/prompt counts and embeddings_enabled.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const stats = await h.mem_stats();
      const st = parseRes(stats);
      reporter.step('mem_stats', {}, st);
      ok(typeof st.documents === 'number' && st.embeddings_enabled === false, 'mem_stats shape');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Session lifecycle',
    goal: 'mem_session_start and mem_session_end create and close a session.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const sessStart = await h.mem_session_start({ project: PROJECT_NAME });
      const sess = parseRes(sessStart);
      reporter.step('mem_session_start', { project: PROJECT_NAME }, { session_id: sess.session_id });
      ok(sess.success && sess.session_id, 'session_start');
      const sessionId = sess.session_id;

      const sessEnd = await h.mem_session_end({ session_id: sessionId });
      const endParsed = parseRes(sessEnd);
      reporter.step('mem_session_end', { session_id: sessionId }, endParsed);
      ok(endParsed.success, 'session_end');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Session summary becomes searchable',
    goal: 'mem_session_summary stores a summary that appears in search.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const sessStart2 = await h.mem_session_start({ project: PROJECT_NAME });
      const sessionId2 = parseRes(sessStart2).session_id;
      const summaryRes = await h.mem_session_summary({ session_id: sessionId2, content: sessionSummaryContent });
      reporter.step('mem_session_summary', { content: sessionSummaryContent.slice(0, 50) + '...' }, parseRes(summaryRes));
      ok(parseRes(summaryRes).success, 'session_summary success');

      const searchSummary = await h.mem_search({ query: 'decided SQLite', project: PROJECT_NAME });
      const summarySearchParsed = parseRes(searchSummary);
      reporter.step('mem_search (summary)', { query: 'decided SQLite' }, summarySearchParsed, { highlight: ['title', 'snippet'] });
      ok(summarySearchParsed.results.length >= 1, 'summary searchable');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Save prompt',
    goal: 'mem_save_prompt stores a prompt and stats reflect it.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);
      const sessStart = await h.mem_session_start({ project: PROJECT_NAME });
      const sessionId2 = parseRes(sessStart).session_id;

      const promptRes = await h.mem_save_prompt({ session_id: sessionId2, content: promptContent });
      reporter.step('mem_save_prompt', { content: promptContent.slice(0, 40) + '...' }, parseRes(promptRes));
      ok(parseRes(promptRes).success, 'mem_save_prompt success');

      const stats2 = await h.mem_stats();
      ok(parseRes(stats2).prompts >= 1, 'prompts count');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Timeline around an observation',
    goal: 'mem_timeline returns before/focus/after for an observation in a session.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const sessStart3 = await h.mem_session_start({ project: PROJECT_NAME });
      const sessionId3 = parseRes(sessStart3).session_id;
      const docA = parseRes(await h.mem_save({ ...timelineFirst, session_id: sessionId3 }));
      const docB = parseRes(await h.mem_save({ ...timelineSecond, session_id: sessionId3 }));
      reporter.step('mem_save x2 (same session)', { session_id: sessionId3 }, { docA: docA.id, docB: docB.id });

      const timelineRes = await h.mem_timeline({ observation_id: docB.id });
      const tl = parseRes(timelineRes);
      reporter.step('mem_timeline', { observation_id: docB.id }, { focus: tl.focus?.title, beforeCount: tl.before?.length, afterCount: tl.after?.length });
      ok(tl.focus && tl.focus.id === docB.id, 'timeline focus');
      ok(Array.isArray(tl.before) && tl.before.length >= 1, 'timeline before');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Manual edit and reindex',
    goal: 'Editing a Markdown file and reindexing makes the new content searchable.',
    run: async function (ctx) {
      const { h, reporter, fs } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };
      const s1 = ctx.shared?.decisionDoc;
      if (!s1) throw new Error('Requires decisionDoc from earlier scenario');
      const docPath = s1.path;

      reporter.startScenario(this.name, this.goal);

      let raw = fs.readFileSync(docPath, 'utf8');
      raw = raw.replace('Updated body.', manualEditSnippet);
      fs.writeFileSync(docPath, raw);
      reporter.step('Manual edit', { path: docPath }, 'replaced "Updated body." with realistic snippet');

      await h.mem_reindex({ full: true });
      reporter.step('mem_reindex', { full: true }, {});

      const searchA = await h.mem_search({ query: 'Manual edits' });
      const searchAParsed = parseRes(searchA);
      reporter.step('mem_search (after edit)', { query: 'Manual edits' }, searchAParsed, { highlight: ['title', 'snippet'] });
      ok(searchAParsed.results.length >= 1, 'edited phrase searchable');

      const obsEdit = await h.mem_get_observation({ id: s1.id });
      const obsEditParsed = parseRes(obsEdit);
      ok(obsEditParsed.content && obsEditParsed.content.includes(manualEditSnippet.slice(0, 20)), 'get_observation reflects edit');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Full reindex from disk',
    goal: 'fullReindex rebuilds the index from Markdown files; search works after.',
    run: async function (ctx) {
      const { h, reporter, config } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };
      if (!ctx.shared?.decisionDoc) throw new Error('Requires decisionDoc');

      reporter.startScenario(this.name, this.goal);

      const { fullReindex } = await import('../../src/core/indexing/reindex.js');
      const reindexResult = fullReindex(config);
      reporter.step('fullReindex', {}, reindexResult);
      ok(reindexResult.indexed >= 1, 'full reindex indexed');

      const searchAfter = await h.mem_search({ query: 'Manual edits' });
      ok(parseRes(searchAfter).results.length >= 1, 'searchable after rebuild');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Move file and reindex (path is source of location)',
    goal: 'Moving a .md file to another folder: incremental reindex desindexa old path and indexa new path; doc remains findable by id.',
    run: async function (ctx) {
      const { h, reporter, config, fs } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };
      if (!ctx.shared?.decisionDoc) throw new Error('Requires decisionDoc');

      reporter.startScenario(this.name, this.goal);

      const docId = ctx.shared.decisionDoc.id;
      const oldPath = ctx.shared.decisionDoc.path;
      if (!fs.existsSync(oldPath)) throw new Error('decisionDoc path missing');
      const raw = fs.readFileSync(oldPath, 'utf8');
      const rootDir = path.dirname(path.dirname(oldPath));
      const architectureDir = path.join(rootDir, 'architecture');
      if (!fs.existsSync(architectureDir)) fs.mkdirSync(architectureDir, { recursive: true });
      const newPath = path.join(architectureDir, path.basename(oldPath));
      fs.writeFileSync(newPath, raw);
      fs.unlinkSync(oldPath);
      reporter.step('Move file', { from: oldPath, to: newPath }, {});

      const reindexRes = await h.mem_reindex({ full: false });
      const reindexParsed = parseRes(reindexRes);
      reporter.step('mem_reindex', { full: false }, reindexParsed);
      ok(reindexParsed.indexed >= 1 || reindexParsed.removed >= 1, 'reindex touched index');

      const obsRes = await h.mem_get_observation({ id: docId });
      const obs = parseRes(obsRes);
      ok(!obs.error && obs.id === docId, 'get_observation by id still works after move');
      ok(obs.title != null || (obs.content && obs.content.length > 0), 'observation has title or content');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'No duplicates after incremental reindex',
    goal: 'Running incremental reindex without file changes does not duplicate documents.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const stats3 = await h.mem_stats();
      await h.mem_reindex({ full: false });
      const stats4 = await h.mem_stats();
      const docs3 = parseRes(stats3).documents;
      const docs4 = parseRes(stats4).documents;
      reporter.step('mem_reindex (incremental)', { full: false }, { docsBefore: docs3, docsAfter: docs4 });
      ok(docs4 === docs3, 'no duplicate docs');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Home in merged search',
    goal: 'Merged search returns both project and home results; home note appears.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const homeSearch = await h.mem_search({ query: 'reindex', scope_mode: 'merged' });
      const homeResults = parseRes(homeSearch).results;
      reporter.step('mem_search (merged)', { query: 'reindex', scope_mode: 'merged' }, { results: homeResults }, { highlight: ['scope', 'title', 'snippet'] });
      const homeInResults = homeResults.some((r) => r.scope === 'home');
      ok(homeInResults, 'home in merged');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Project outranks home in merged',
    goal: 'In merged mode, project results rank before home for same topic.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const rankSearch = await h.mem_search({ query: 'reindex', scope_mode: 'merged', project: PROJECT_NAME, limit: 5 });
      const rankResults = parseRes(rankSearch).results;
      reporter.step('mem_search (merged)', { query: 'reindex', limit: 5 }, { results: rankResults }, { highlight: ['scope', 'title', 'score'] });
      const firstProject = rankResults.find((r) => r.scope === 'project');
      const firstHome = rankResults.find((r) => r.scope === 'home');
      const projectFirst = !firstHome || !firstProject || rankResults.indexOf(firstProject) <= rankResults.indexOf(firstHome);
      ok(projectFirst, 'project first');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Project save does not overwrite home',
    goal: 'Saving a project-scoped note with same topic_key as home does not overwrite the home note.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      await h.mem_save(patternIncrementalReindexProject);
      reporter.step('mem_save (project, same topic_key)', { topic_key: patternIncrementalReindexProject.topic_key }, {});

      const homeObs = await h.mem_search({ query: 'Reindex only changed', scope_mode: 'home-only' });
      const homeObsParsed = parseRes(homeObs);
      reporter.step('mem_search (home-only)', { query: 'Reindex only changed', scope_mode: 'home-only' }, homeObsParsed, { highlight: ['title', 'snippet'] });
      ok(homeObsParsed.results.length >= 1, 'home note intact');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Semantic / embeddings (save and search)',
    goal: 'With embeddings enabled, save and search work (FTS or hybrid).',
    run: async function (ctx) {
      const { reporter } = ctx;
      const hSemantic = ctx.hSemantic;
      const parseRes = ctx.parse || parse;
      if (!hSemantic) {
        reporter.startScenario(this.name, this.goal);
        reporter.check('skipped (embeddings not in use)', true);
        reporter.endScenario(1, 0);
        return { passed: 1, failed: 0 };
      }
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const saveSem = await hSemantic.mem_save(semanticFallbackDoc);
      const saveSemParsed = parseRes(saveSem);
      reporter.step('mem_save (embeddings on)', { title: semanticFallbackDoc.title }, saveSemParsed);
      ok(saveSemParsed.success, 'save with embeddings');

      const searchSem = await hSemantic.mem_search({ query: 'semantic fallback', project: PROJECT_NAME });
      const searchSemParsed = parseRes(searchSem);
      reporter.step('mem_search', { query: 'semantic fallback' }, searchSemParsed, { highlight: ['title', 'snippet', 'score'] });
      ok(searchSemParsed.results.length >= 1, 'search returns results');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  },
  {
    name: 'Error handling: update/get invalid id',
    goal: 'mem_update and mem_get_observation with non-existent id return clear errors.',
    run: async function (ctx) {
      const { h, reporter } = ctx;
      const parseRes = ctx.parse || parse;
      let p = 0, f = 0;
      const ok = (cond, msg) => { if (cond) p++; else f++; reporter.check(msg, cond); };

      reporter.startScenario(this.name, this.goal);

      const updBad = await h.mem_update({ id: 'nonexist01', title: 'No', content: 'No' });
      const updBadParsed = parseRes(updBad);
      reporter.step('mem_update (bad id)', { id: 'nonexist01' }, updBadParsed);
      ok(updBadParsed.success === false && updBadParsed.error, 'update fails cleanly');

      const getBad = await h.mem_get_observation({ id: 'nonexist02' });
      const getBadParsed = parseRes(getBad);
      reporter.step('mem_get_observation (bad id)', { id: 'nonexist02' }, getBadParsed);
      ok(getBadParsed.error === 'Observation not found' || !!getBadParsed.error, 'get_observation error');

      reporter.endScenario(p, f);
      return { passed: p, failed: f };
    }
  }
];

// Fix binding of `this` for each scenario's run()
scenarios.forEach((s) => {
  const run = s.run;
  s.run = function (ctx) {
    return run.call(s, ctx);
  };
});
