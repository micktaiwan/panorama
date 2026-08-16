import { SearchQualityRunsCollection } from './collections';
import { getQdrantUrl, getAIConfigAsync } from '/imports/api/_shared/config';
import { getQdrantClient, COLLECTION, VECTOR_SIZE } from '/imports/api/search/vectorStore';

const MAX_FAILURES_STORED = 50;
const MAX_QUERIES_PER_FAILURE = 5;

const clampTitle = (s, max = 120) => {
  const str = String(s || '').replace(/\s+/g, ' ').trim();
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};

// Keep only what is needed to act on a failure: which document, which queries
// missed it, and where it landed. The full per-query payload (top results,
// token lists) stays in memory for the UI and is not persisted.
const compactFailures = (failures = []) => failures.slice(0, MAX_FAILURES_STORED).map(f => ({
  kind: f.sourceDoc?.kind || null,
  id: f.sourceDoc?.id || null,
  title: clampTitle(f.sourceDoc?.title),
  projectId: f.sourceDoc?.projectId || null,
  successRate: f.successRate ?? null,
  avgRank: f.avgRank ?? null,
  failedQueries: (f.failedQueries || []).slice(0, MAX_QUERIES_PER_FAILURE).map(q => ({
    query: q.query,
    type: q.type,
    lexicalOverlap: q.lexicalOverlap ?? null,
    error: q.error || null
  }))
}));

const compactNotFound = (totalFailures = []) => totalFailures.slice(0, MAX_FAILURES_STORED).map(f => ({
  kind: f.sourceDoc?.kind || null,
  id: f.sourceDoc?.id || null,
  title: clampTitle(f.sourceDoc?.title),
  queries: (f.queries || []).slice(0, MAX_QUERIES_PER_FAILURE).map(q => ({ query: q.query, type: q.type }))
}));

// Snapshot of what the run was measuring: swapping embedding model or losing
// Qdrant changes the numbers, so a run without this context is not comparable.
const readEnvironment = async (userId) => {
  const url = getQdrantUrl();
  const config = await getAIConfigAsync(userId);
  const env = {
    qdrantConfigured: !!url,
    qdrantCollection: COLLECTION(),
    vectorSize: VECTOR_SIZE(),
    aiMode: config?.mode || null,
    embeddingModel: config?.mode === 'local'
      ? config?.local?.embeddingModel || null
      : config?.remote?.embeddingModel || null,
    points: null,
    collectionExists: false
  };
  if (!url) return env;
  const client = await getQdrantClient();
  try {
    const info = await client.getCollection(env.qdrantCollection);
    env.collectionExists = !!info;
    const cnt = await client.count(env.qdrantCollection, { exact: true });
    env.points = cnt?.result?.count ?? cnt?.count ?? null;
  } catch (e) {
    env.collectionError = e?.message || String(e);
  }
  return env;
};

const normalizeParams = (opts = {}) => ({
  limit: Math.max(1, Math.min(50, Number(opts?.limit) || 10)),
  maxDocsPerKind: Number(opts?.maxDocsPerKind) > 0
    ? Math.max(1, Math.min(50, Math.floor(Number(opts.maxDocsPerKind))))
    : null,
  kinds: Array.isArray(opts?.kinds) && opts.kinds.length > 0
    ? opts.kinds.map(String).filter(k => ['note', 'task', 'project', 'email'].includes(k))
    : null,
  verbose: !!opts?.verbose
});

export const createRun = async ({ userId, source = 'ui', opts = {} }) => {
  const params = normalizeParams(opts);
  return SearchQualityRunsCollection.insertAsync({
    userId,
    source,
    status: 'running',
    startedAt: new Date(),
    finishedAt: null,
    durationMs: null,
    params,
    env: null,
    summary: null,
    failurePatterns: null,
    recommendations: [],
    recommendationsSummary: null,
    failures: [],
    notFound: [],
    error: null
  });
};

// Run the whole quality test and store its outcome on the run document.
// Returns the FULL in-memory results (what the UI renders) plus the runId.
export const executeRun = async ({ runId, userId, source = 'ui', opts = {} }) => {
  const params = normalizeParams(opts);
  const startedAt = Date.now();
  const id = runId || await createRun({ userId, source, opts });

  const finishWithError = async (message) => {
    await SearchQualityRunsCollection.updateAsync(id, {
      $set: {
        status: 'error',
        error: message,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt
      }
    });
    return { runId: id, error: message, tests: [], summary: {}, failures: [], totalFailures: [] };
  };

  try {
    const env = await readEnvironment(userId);
    await SearchQualityRunsCollection.updateAsync(id, { $set: { env } });

    const { generateTestDataset } = await import('/imports/api/search/generateQualityTests');
    const dataset = await generateTestDataset({
      userId,
      kinds: params.kinds,
      maxDocsPerKind: params.maxDocsPerKind
    });
    if (dataset.length === 0) {
      return finishWithError('No test data could be generated. Ensure you have notes, tasks, or projects with content.');
    }
    console.log(`[searchQuality] Run ${id}: ${dataset.length} test cases (source: ${source})`);

    const { runQualityTests } = await import('/imports/api/search/runQualityTests');
    const results = await runQualityTests(dataset, { limit: params.limit, verbose: params.verbose, userId });

    const { analyzeRecommendations } = await import('/imports/api/search/analyzeRecommendations');
    const analysis = analyzeRecommendations(results);

    await SearchQualityRunsCollection.updateAsync(id, {
      $set: {
        status: 'done',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        summary: results.summary,
        failurePatterns: results.failurePatterns,
        recommendations: analysis.recommendations,
        recommendationsSummary: analysis.summary,
        failures: compactFailures(results.failures),
        notFound: compactNotFound(results.totalFailures),
        counts: {
          testedDocs: results.config?.totalTests ?? dataset.length,
          testedQueries: results.summary?.totalQueries ?? 0,
          docsWithFailures: (results.failures || []).length,
          docsNeverFound: (results.totalFailures || []).length
        }
      }
    });

    return {
      ...results,
      runId: id,
      recommendations: analysis.recommendations,
      recommendationsSummary: analysis.summary
    };
  } catch (error) {
    console.error('[searchQuality] Run failed', id, error);
    return finishWithError(error?.message || String(error));
  }
};

// Fire-and-forget variant: returns the runId immediately so a caller with a
// short timeout (MCP, HTTP) can poll instead of holding the connection open.
export const startRun = async ({ userId, source = 'mcp', opts = {} }) => {
  const runId = await createRun({ userId, source, opts });
  setTimeout(() => {
    executeRun({ runId, userId, source, opts }).catch(async (e) => {
      console.error('[searchQuality] background run crashed', runId, e);
      await SearchQualityRunsCollection.updateAsync(runId, {
        $set: {
          status: 'error',
          error: e?.message || String(e),
          finishedAt: new Date()
        }
      });
    });
  }, 0);
  return { runId, params: normalizeParams(opts) };
};
