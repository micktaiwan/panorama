import { chatComplete } from '/imports/api/_shared/llmProxy';

// Normalize a name for dedup comparison (accents/case/punctuation insensitive).
export const normName = (s) => String(s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Deterministic keyword layer: which projects have a keyword literally present in `text`.
// Token-boundary match on the normalized text (space-padded) so "api" matches "fix api bug"
// but NOT "rapide" — guarantees a candidate when the LLM misses an obvious keyword (or fails).
// `minLen` raises the minimum keyword length — used for file-path matching, where short
// generic tokens ("api", "ui", "js") appear in almost every path.
// Returns [{ opportunityId, keyword }] (first matching keyword per project).
export const matchKeywords = (text, opportunities, minLen = 2) => {
  const hay = ` ${normName(text)} `;
  const hits = [];
  for (const o of (opportunities || [])) {
    for (const kw of (o.keywords || [])) {
      const k = normName(kw);
      if (k.length >= minLen && hay.includes(` ${k} `)) { hits.push({ opportunityId: o._id, keyword: kw }); break; }
    }
  }
  return hits;
};

// Minimum keyword length when matching against file paths (see matchKeywords).
const PATH_KEYWORD_MIN_LEN = 4;

// Cap on changed-file paths per commit: persisted on the doc AND listed in the deep
// prompt — one shared value so what the deep ranker saw matches what later reranks see.
export const MAX_COMMIT_FILES = 80;

// `files` rides through two shapes: GitHub detail objects [{ filename, ... }] and
// persisted string arrays. Normalize both to plain path strings.
export const fileNamesOf = (files) => (files || [])
  .map(f => (typeof f === 'string' ? f : f?.filename))
  .filter(Boolean);

// Score given to a deterministic keyword match (high confidence, but below a perfect 1).
const KEYWORD_SCORE = 0.95;

// Render the project list for the ranking prompts: name, keywords, and the few-shot
// examples (messages of commits the user already classified into the project).
const renderOppList = (opportunities) => opportunities
  .map(o => {
    const kw = o.keywords?.length ? ` — mots-clés: ${o.keywords.join(', ')}` : '';
    const ex = o.examples?.length
      ? `\n  déjà classés ici: ${o.examples.map(m => `« ${String(m).replace(/[«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)} »`).join(' · ')}`
      : '';
    return `- [id:${o._id}] ${o.name}${kw}${ex}`;
  })
  .join('\n');

/**
 * Rank a BATCH of commits against the EXISTING opportunities. The LLM reads the first
 * 600 chars of each message + the changed file paths when known ("fichiers:") + the
 * projects' keywords and few-shot examples (commits already classified by the user);
 * the deterministic keyword layer scans the FULL message and file paths.
 * Returns Map(sha -> [{opportunityId, score}]) with at most 5 candidates per commit
 * (ids validated, never invented).
 * The model echoes back each sha so results align by sha, not by position.
 */
export const rankCommitsBatch = async ({ commits, opportunities }, userId) => {
  if (!opportunities || opportunities.length === 0 || !commits || commits.length === 0) return new Map();

  const oppList = renderOppList(opportunities);
  const commitList = commits
    .map(c => {
      const files = fileNamesOf(c.files).slice(0, 15).join(' ');
      return `[sha:${c.sha}] ${(c.message || '').replace(/\s+/g, ' ').trim().slice(0, 600)}`
        + (files ? ` | fichiers: ${files.slice(0, 400)}` : '');
    })
    .join('\n');

  const system = 'You assign git commits to the most likely EXISTING projects. '
    + 'For EACH commit, return up to 5 candidate projects ranked by likelihood, each with a score in [0,1]. '
    + 'Base your decision on the commit message text and the project keywords. Some commits also list '
    + 'their changed file paths ("fichiers:") — paths are a strong signal of which area/project is touched. '
    + 'Some projects list example commits already classified into them by the user ("déjà classés ici") — '
    + 'a strong signal alongside the keywords; the absence of examples for a project is not evidence against it. '
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

  // An LLM failure (timeout, provider down, invalid JSON) must not kill the batch: the
  // deterministic keyword layer below still produces candidates for the whole slice.
  let parsed = {};
  let resultText = '';
  try {
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
    resultText = result?.text || '';
    parsed = JSON.parse(resultText || '{}') || {};
  } catch (e) {
    // resultText set => chatComplete succeeded but returned invalid JSON: log an excerpt.
    console.error('[classifier.rankCommitsBatch] LLM ranking failed, falling back to keywords:',
      e?.reason || e?.message || e,
      resultText ? `· payload: ${resultText.slice(0, 200)}` : '');
  }
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
  // appears in the commit message or its file paths — even if the LLM omitted it or the
  // batch failed (empty out). Path matching requires longer keywords (generic path tokens).
  for (const c of commits) {
    const paths = fileNamesOf(c.files).join(' ');
    const hits = [
      ...matchKeywords(c.message, opportunities),
      ...(paths ? matchKeywords(paths, opportunities, PATH_KEYWORD_MIN_LEN) : [])
    ];
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
 * Deep classification of ONE commit against EXISTING opportunities, reading the stored
 * commit message (4000-char cap, same as messageFull) AND the list of changed files,
 * plus the projects' keywords and few-shot examples (the "analyze deeper" action).
 * Returns [{ opportunityId, score, reasoning }] (ids validated, never invented), top 5.
 */
export const rankCommitDeep = async ({ message, files, opportunities }, userId) => {
  if (!opportunities || opportunities.length === 0) return [];

  const oppList = renderOppList(opportunities);
  const names = fileNamesOf(files);
  const listed = names.slice(0, MAX_COMMIT_FILES);
  const fileList = listed.map(f => `- ${f}`).join('\n') || '(aucun fichier listé)';

  const system = 'You assign ONE git commit to the most likely EXISTING projects. '
    + 'Read its FULL commit message AND the list of changed file paths (paths are a strong signal of which area/project is touched). '
    + 'Projects may include example commits already classified into them by the user ("déjà classés ici") — '
    + 'a strong signal alongside the keywords; the absence of examples for a project is not evidence against it. '
    + 'Return up to 5 candidate projects ranked by likelihood, each with a score in [0,1] and a ONE-sentence reasoning in French. '
    + 'Only use project ids from the provided list — never invent an id. '
    + 'If no project plausibly matches, return an empty candidates array.';
  const user = `Projects:\n${oppList}\n\n`
    + `Commit message:\n${String(message || '').slice(0, 4000)}\n\n`
    + `Changed files (${names.length}${names.length > listed.length ? `, ${listed.length} listés` : ''}):\n${fileList}\n\n`
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

  // One commit + capped file list: a much smaller budget than the 8-commit batch call.
  // Caps the deep-rescue worst case; the caller handles a thrown timeout/provider error.
  const result = await chatComplete({
    system,
    messages: [{ role: 'user', content: user }],
    responseFormat: 'json',
    schema,
    temperature: 0,
    timeoutMs: 45000,
    route: 'classify',
    userId
  });

  let parsed;
  try { parsed = JSON.parse(result?.text || '{}') || {}; } catch (e) {
    console.error('[classifier.rankCommitDeep] invalid LLM JSON:', e?.message, `· payload: ${String(result?.text || '').slice(0, 200)}`);
    parsed = {};
  }
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

  // Deterministic keyword layer: message (any keyword) + file paths (longer keywords only —
  // short path tokens like "api"/"ui" are too generic). Scans `listed`, not `names`, so the
  // MAX_COMMIT_FILES invariant holds: later reranks (persisted files) see the same signal.
  const hits = [
    ...matchKeywords(message, opportunities),
    ...(listed.length ? matchKeywords(listed.join(' '), opportunities, PATH_KEYWORD_MIN_LEN) : [])
  ];
  for (const h of hits) {
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
  try { parsed = JSON.parse(result?.text || '{}') || {}; } catch (e) {
    console.error('[classifier.suggestProjectKeywords] invalid LLM JSON:', e?.message, `· payload: ${String(result?.text || '').slice(0, 200)}`);
    parsed = {};
  }
  const existing = new Set((currentKeywords || []).map(k => String(k).toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const k of (Array.isArray(parsed.keywords) ? parsed.keywords : [])) {
    const v = String(k || '').trim().toLowerCase();
    if (v && !existing.has(v) && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out.slice(0, 10);
};

