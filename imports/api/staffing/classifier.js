import { chatComplete } from '/imports/api/_shared/llmProxy';

// Normalize a name for dedup comparison (accents/case/punctuation insensitive).
export const normName = (s) => String(s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Deterministic keyword layer: which projects have a keyword literally present in `text`.
// Token-boundary match on the normalized text (space-padded) so "api" matches "fix api bug"
// but NOT "rapide" — guarantees a candidate when the LLM misses an obvious keyword (or fails).
// Returns [{ opportunityId, keyword }] (first matching keyword per project).
export const matchKeywords = (text, opportunities) => {
  const hay = ` ${normName(text)} `;
  const hits = [];
  for (const o of (opportunities || [])) {
    for (const kw of (o.keywords || [])) {
      const k = normName(kw);
      if (k.length >= 2 && hay.includes(` ${k} `)) { hits.push({ opportunityId: o._id, keyword: kw }); break; }
    }
  }
  return hits;
};

// Score given to a deterministic keyword match (high confidence, but below a perfect 1).
const KEYWORD_SCORE = 0.95;

const summarizeCommits = (commits, max = 8) => commits
  .slice(0, max)
  .map(c => `- ${(c.message || '').split('\n')[0].slice(0, 120)}`)
  .join('\n');

/**
 * Rank a BATCH of commits against the EXISTING opportunities, reading each commit's
 * full message + the projects' keywords. Returns Map(sha -> [{opportunityId, score}])
 * with at most 5 candidates per commit (ids validated, never invented).
 * The model echoes back each sha so results align by sha, not by position.
 */
export const rankCommitsBatch = async ({ commits, opportunities }, userId) => {
  if (!opportunities || opportunities.length === 0 || !commits || commits.length === 0) return new Map();

  const oppList = opportunities
    .map(o => `- [id:${o._id}] ${o.name}${o.keywords?.length ? ` — mots-clés: ${o.keywords.join(', ')}` : ''}`)
    .join('\n');
  const commitList = commits
    .map(c => `[sha:${c.sha}] ${(c.message || '').replace(/\s+/g, ' ').trim().slice(0, 280)}`)
    .join('\n');

  const system = 'You assign git commits to the most likely EXISTING projects. '
    + 'For EACH commit, return up to 5 candidate projects ranked by likelihood, each with a score in [0,1]. '
    + 'Base your decision on the commit message text and the project keywords. '
    + 'Only use project ids from the provided list — never invent an id. '
    + 'If no project plausibly matches a commit, return an empty candidates array for that commit. '
    + 'Echo back the exact sha of each commit so results can be aligned.';
  const user = `Projects:\n${oppList}\n\nCommits to classify:\n${commitList}\n\n`
    + 'For each commit, give the up-to-5 most likely projects (ranked, with scores).';

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sha: { type: 'string' },
            candidates: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  opportunityId: { type: 'string' },
                  score: { type: 'number' }
                },
                required: ['opportunityId', 'score']
              }
            }
          },
          required: ['sha', 'candidates']
        }
      }
    },
    required: ['results']
  };

  const result = await chatComplete({
    system,
    messages: [{ role: 'user', content: user }],
    responseFormat: 'json',
    schema,
    temperature: 0,
    timeoutMs: 90000,
    route: 'classify',
    userId
  });

  let parsed;
  try { parsed = JSON.parse(result?.text || '{}'); } catch (_e) { parsed = {}; }
  const validIds = new Set(opportunities.map(o => o._id));
  const out = new Map();
  for (const r of (Array.isArray(parsed.results) ? parsed.results : [])) {
    if (!r || !r.sha) continue;
    const candidates = (Array.isArray(r.candidates) ? r.candidates : [])
      .filter(c => c && validIds.has(c.opportunityId))
      .map(c => ({ opportunityId: c.opportunityId, score: Number.isFinite(c.score) ? Math.max(0, Math.min(1, c.score)) : 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    out.set(r.sha, candidates);
  }

  // Deterministic keyword layer: guarantee a candidate whenever a project keyword literally
  // appears in the commit message — even if the LLM omitted it or the batch failed (empty out).
  for (const c of commits) {
    const hits = matchKeywords(c.message, opportunities);
    if (!hits.length) continue;
    const byId = new Map((out.get(c.sha) || []).map(x => [x.opportunityId, x]));
    for (const h of hits) {
      const prev = byId.get(h.opportunityId);
      if (prev) prev.score = Math.max(prev.score, KEYWORD_SCORE);
      else byId.set(h.opportunityId, { opportunityId: h.opportunityId, score: KEYWORD_SCORE });
    }
    out.set(c.sha, [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 5));
  }
  return out;
};

/**
 * Deep classification of ONE commit against EXISTING opportunities, reading the FULL
 * commit message AND the list of changed files (the on-demand "analyze deeper" action).
 * Returns [{ opportunityId, score, reasoning }] (ids validated, never invented), top 5.
 */
export const rankCommitDeep = async ({ message, files, opportunities }, userId) => {
  if (!opportunities || opportunities.length === 0) return [];

  const oppList = opportunities
    .map(o => `- [id:${o._id}] ${o.name}${o.keywords?.length ? ` — mots-clés: ${o.keywords.join(', ')}` : ''}`)
    .join('\n');
  const fileList = (files || []).slice(0, 80).map(f => `- ${f.filename}`).join('\n') || '(aucun fichier listé)';

  const system = 'You assign ONE git commit to the most likely EXISTING projects. '
    + 'Read its FULL commit message AND the list of changed file paths (paths are a strong signal of which area/project is touched). '
    + 'Return up to 5 candidate projects ranked by likelihood, each with a score in [0,1] and a ONE-sentence reasoning in French. '
    + 'Only use project ids from the provided list — never invent an id. '
    + 'If no project plausibly matches, return an empty candidates array.';
  const user = `Projects:\n${oppList}\n\n`
    + `Commit message:\n${String(message || '').slice(0, 2000)}\n\n`
    + `Changed files (${(files || []).length}):\n${fileList}\n\n`
    + 'Which existing projects does this commit most likely belong to?';

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            opportunityId: { type: 'string' },
            score: { type: 'number' },
            reasoning: { type: 'string' }
          },
          required: ['opportunityId', 'score', 'reasoning']
        }
      }
    },
    required: ['candidates']
  };

  const result = await chatComplete({
    system,
    messages: [{ role: 'user', content: user }],
    responseFormat: 'json',
    schema,
    temperature: 0,
    timeoutMs: 90000,
    route: 'classify',
    userId
  });

  let parsed;
  try { parsed = JSON.parse(result?.text || '{}'); } catch (_e) { parsed = {}; }
  const validIds = new Set(opportunities.map(o => o._id));
  const byId = new Map();
  for (const c of (Array.isArray(parsed.candidates) ? parsed.candidates : [])) {
    if (!c || !validIds.has(c.opportunityId)) continue;
    byId.set(c.opportunityId, {
      opportunityId: c.opportunityId,
      score: Number.isFinite(c.score) ? Math.max(0, Math.min(1, c.score)) : 0,
      reasoning: String(c.reasoning || '').trim()
    });
  }

  // Deterministic keyword layer: match on the message AND the changed file paths.
  const matchText = `${message || ''} ${(files || []).map(f => f.filename).join(' ')}`;
  for (const h of matchKeywords(matchText, opportunities)) {
    const prev = byId.get(h.opportunityId);
    if (prev) prev.score = Math.max(prev.score, KEYWORD_SCORE);
    else byId.set(h.opportunityId, { opportunityId: h.opportunityId, score: KEYWORD_SCORE, reasoning: `Mot-clé « ${h.keyword} » présent` });
  }

  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 5);
};

/**
 * Suggest additional KEYWORDS for one project, looking at ALL its already-classified
 * commits + its current keywords. Returns a deduped list (existing keywords excluded),
 * lowercased, at most 10. The user validates which ones to add.
 */
export const suggestProjectKeywords = async ({ projectName, currentKeywords, commitMessages }, userId) => {
  if (!commitMessages || commitMessages.length === 0) return [];
  const current = (currentKeywords || []).join(', ') || '(aucun)';
  const sample = commitMessages
    .slice(0, 80)
    .map(m => `- ${String(m || '').replace(/\s+/g, ' ').trim().slice(0, 160)}`)
    .join('\n');

  const system = 'You suggest additional KEYWORDS for a software project so future git commits belonging to it '
    + 'can be auto-classified. Look at the commit messages already assigned to this project. Propose short, '
    + 'lowercase, distinctive keywords (single words or 2-word phrases) that recur and characterize the project. '
    + 'Do NOT repeat the current keywords. Avoid generic dev words (fix, feat, update, refactor, test, chore, wip, '
    + 'bump, release, merge). Return at most 10 keywords, ordered by usefulness.';
  const user = `Project: ${projectName}\nCurrent keywords: ${current}\n\n`
    + `Commit messages already classified into this project:\n${sample}\n\n`
    + 'Which keywords are missing to recognize similar commits?';

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { keywords: { type: 'array', items: { type: 'string' } } },
    required: ['keywords']
  };

  const result = await chatComplete({
    system,
    messages: [{ role: 'user', content: user }],
    responseFormat: 'json',
    schema,
    temperature: 0.2,
    timeoutMs: 90000,
    route: 'classify',
    userId
  });

  let parsed;
  try { parsed = JSON.parse(result?.text || '{}'); } catch (_e) { parsed = {}; }
  const existing = new Set((currentKeywords || []).map(k => String(k).toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const k of (Array.isArray(parsed.keywords) ? parsed.keywords : [])) {
    const v = String(k || '').trim().toLowerCase();
    if (v && !existing.has(v) && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out.slice(0, 10);
};

/**
 * Classify ONE branch against the list of EXISTING opportunities.
 * Returns { opportunityId: string|null, confidence: 0..1, reasoning }.
 * opportunityId is always either one of the provided ids or null — never invented.
 */
export const classifyBranch = async ({ branchName, commits, modules, opportunities }, userId) => {
  if (!opportunities || opportunities.length === 0) {
    return { opportunityId: null, confidence: 0, reasoning: 'no existing opportunities to match' };
  }
  const oppList = opportunities.map((o, i) => `${i + 1}. [id:${o._id}] ${o.name}${o.cycle ? ` (${o.cycle})` : ''}`).join('\n');
  const modStr = (modules || []).map(m => `${m.module}(${m.count})`).join(', ') || 'unknown';

  const system = 'You map a git branch to one of a fixed list of existing projects (opportunities). '
    + 'You MUST either return the exact id of one listed opportunity, or null if none clearly matches. '
    + 'Never invent an id. Be conservative: if unsure, return null with low confidence.';
  const user = `Existing opportunities:\n${oppList}\n\n`
    + `Branch: ${branchName}\n`
    + `Modules touched: ${modStr}\n`
    + `Recent commit messages:\n${summarizeCommits(commits)}\n\n`
    + 'Which opportunity does this branch belong to?';

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      opportunityId: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' }
    },
    required: ['opportunityId', 'confidence', 'reasoning']
  };

  const result = await chatComplete({
    system,
    messages: [{ role: 'user', content: user }],
    responseFormat: 'json',
    schema,
    temperature: 0,
    route: 'classify',
    userId
  });

  let parsed;
  try { parsed = JSON.parse(result?.text || '{}'); } catch (_e) { parsed = {}; }
  const validIds = new Set(opportunities.map(o => o._id));
  const opportunityId = parsed.opportunityId && validIds.has(parsed.opportunityId) ? parsed.opportunityId : null;
  const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  return { opportunityId, confidence, reasoning: String(parsed.reasoning || '') };
};

/**
 * From clusters of UNMATCHED branches, propose candidate NEW opportunities.
 * Dedup against existing opportunity names so near-duplicates are never proposed.
 * Returns [{ name, rationale, branches: [string], modules: [string], personIds: [string], confidence }].
 */
export const suggestNewOpportunities = async ({ clusters, existingNames }, userId) => {
  if (!clusters || clusters.length === 0) return [];
  const existingSet = new Set((existingNames || []).map(normName));

  const clusterText = clusters.map((c, i) => {
    const mods = (c.modules || []).map(m => m.module).slice(0, 4).join(', ');
    return `Cluster ${i + 1}: branch "${c.branchName}" · modules: ${mods || 'unknown'}\n  commits:\n`
      + summarizeCommits(c.commits, 5);
  }).join('\n\n');

  const system = 'You propose candidate NEW projects from clusters of git activity that did not match any existing project. '
    + 'Group clusters that clearly belong to the same project. Give each a short, human project name (3-6 words). '
    + 'Do NOT propose generic buckets like "misc" or "maintenance". Only propose when the activity looks like a coherent piece of project work.';
  const user = `These branches did not match any existing project:\n\n${clusterText}\n\n`
    + 'Propose new projects (one per coherent group). Reference clusters by their branch names.';

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            rationale: { type: 'string' },
            branches: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' }
          },
          required: ['name', 'rationale', 'branches', 'confidence']
        }
      }
    },
    required: ['suggestions']
  };

  const result = await chatComplete({
    system,
    messages: [{ role: 'user', content: user }],
    responseFormat: 'json',
    schema,
    temperature: 0.2,
    route: 'classify',
    userId
  });

  let parsed;
  try { parsed = JSON.parse(result?.text || '{}'); } catch (_e) { parsed = {}; }
  const raw = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

  // Map branch names back to clusters to aggregate modules + contributors.
  const byBranch = new Map(clusters.map(c => [c.branchName, c]));
  return raw
    .map(s => {
      const branches = (s.branches || []).filter(b => byBranch.has(b));
      const mods = new Set();
      const personIds = new Set();
      branches.forEach(b => {
        const c = byBranch.get(b);
        (c.modules || []).forEach(m => mods.add(m.module));
        (c.personIds || []).forEach(p => personIds.add(p));
      });
      return {
        name: String(s.name || '').trim(),
        rationale: String(s.rationale || '').trim(),
        branches,
        modules: [...mods],
        personIds: [...personIds],
        confidence: Number.isFinite(s.confidence) ? Math.max(0, Math.min(1, s.confidence)) : 0.5
      };
    })
    .filter(s => s.name && s.branches.length > 0)
    // Dedup safety: drop anything that looks like an existing opportunity.
    .filter(s => !existingSet.has(normName(s.name)));
};
