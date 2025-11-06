// Run quality tests on search results
// Executes generated test queries and calculates relevance metrics

import { Meteor } from 'meteor/meteor';

// Calculate metrics for a set of test results
const calculateMetrics = (testResults) => {
  const allQueryResults = testResults.flatMap(t => t.queries);
  const totalQueries = allQueryResults.length;

  if (totalQueries === 0) {
    return {
      totalTests: 0,
      totalQueries: 0,
      successRate_top3: 0,
      successRate_top5: 0,
      successRate_top10: 0,
      hitRate: 0,
      avgRank: 0,
      avgScore: 0,
      mrr: 0
    };
  }

  const foundCount = allQueryResults.filter(q => q.rank > 0).length;
  const top3Count = allQueryResults.filter(q => q.inTop3).length;
  const top5Count = allQueryResults.filter(q => q.inTop5).length;
  const top10Count = allQueryResults.filter(q => q.inTop10).length;

  // Average rank (only for found results)
  const foundResults = allQueryResults.filter(q => q.rank > 0);
  const avgRank = foundResults.length > 0
    ? foundResults.reduce((sum, q) => sum + q.rank, 0) / foundResults.length
    : 0;

  // Average score (only for found results)
  const scoredResults = allQueryResults.filter(q => q.score !== null);
  const avgScore = scoredResults.length > 0
    ? scoredResults.reduce((sum, q) => sum + q.score, 0) / scoredResults.length
    : 0;

  // Mean Reciprocal Rank (MRR)
  const mrr = totalQueries > 0
    ? allQueryResults.reduce((sum, q) => sum + (q.rank > 0 ? 1 / q.rank : 0), 0) / totalQueries
    : 0;

  return {
    totalTests: testResults.length,
    totalQueries,
    successRate_top3: top3Count / totalQueries,
    successRate_top5: top5Count / totalQueries,
    successRate_top10: top10Count / totalQueries,
    hitRate: foundCount / totalQueries,
    avgRank,
    avgScore,
    mrr
  };
};

// Calculate lexical overlap between query and document
const calculateLexicalOverlap = (query, docTitle, docContent) => {
  const normalize = (text) => String(text || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const queryTokens = normalize(query);
  const docTokens = [...normalize(docTitle), ...normalize(docContent)];

  if (queryTokens.length === 0 || docTokens.length === 0) return { overlap: 0, queryTokens, docTokens: [] };

  const docSet = new Set(docTokens);
  const matches = queryTokens.filter(t => docSet.has(t)).length;
  const overlap = matches / queryTokens.length;

  return { overlap, queryTokens, docTokens: docTokens.slice(0, 20) }; // Limit doc tokens for size
};

// Run quality tests on a generated test dataset
export const runQualityTests = async (testDataset, options = {}) => {
  const { limit = 10, verbose = false } = options;
  const results = [];

  console.log(`[runQualityTests] Starting ${testDataset.length} test cases with limit=${limit}`);

  for (const test of testDataset) {
    const { sourceDoc, queries } = test;
    const queryResults = [];

    for (const queryDef of queries) {
      const { query, type, description } = queryDef;

      if (verbose) {
        console.log(`[runQualityTests] Testing: "${query}" (${type}) for ${sourceDoc.kind}:${sourceDoc.id}`);
      }

      try {
        // Execute search
        const searchRes = await Meteor.callAsync('panorama.search', query, { limit });
        const searchResults = searchRes.results || [];

        // Find position of source document in results
        const expectedId = `${sourceDoc.kind}:${sourceDoc.id}`;
        const resultIndex = searchResults.findIndex(r => r.id === expectedId);
        const rank = resultIndex >= 0 ? resultIndex + 1 : 0; // 0 means not found
        const score = rank > 0 ? searchResults[resultIndex]?.score : null;

        // Top-K metrics
        const inTop3 = rank > 0 && rank <= 3;
        const inTop5 = rank > 0 && rank <= 5;
        const inTop10 = rank > 0 && rank <= 10;

        // NEW: Capture top 5 results that were returned instead
        const topResults = searchResults.slice(0, 5).map(r => ({
          id: r.id,
          kind: r.kind,
          title: r.text || '(no preview)',
          score: r.score,
          rank: searchResults.indexOf(r) + 1
        }));

        // NEW: Calculate lexical overlap
        const lexical = calculateLexicalOverlap(query, sourceDoc.title, '');

        queryResults.push({
          query,
          type,
          description,
          rank,
          score,
          inTop3,
          inTop5,
          inTop10,
          totalResults: searchResults.length,
          topResults, // NEW
          lexicalOverlap: lexical.overlap, // NEW
          queryTokens: lexical.queryTokens, // NEW
          docTitleTokens: lexical.docTokens // NEW
        });

        if (verbose && rank === 0) {
          console.log(`  ❌ NOT FOUND in top-${limit}`);
        } else if (verbose) {
          console.log(`  ✓ Found at rank ${rank} (score: ${score?.toFixed(3) || 'N/A'})`);
        }
      } catch (err) {
        console.error(`[runQualityTests] Error testing query "${query}":`, err);
        queryResults.push({
          query,
          type,
          description,
          rank: 0,
          score: null,
          inTop3: false,
          inTop5: false,
          inTop10: false,
          error: err.message || String(err),
          totalResults: 0
        });
      }
    }

    // Calculate per-document metrics
    const foundQueries = queryResults.filter(q => q.rank > 0);
    const avgRank = foundQueries.length > 0
      ? foundQueries.reduce((sum, q) => sum + q.rank, 0) / foundQueries.length
      : 0;
    const avgScore = foundQueries.length > 0
      ? foundQueries.reduce((sum, q) => sum + (q.score || 0), 0) / foundQueries.length
      : 0;
    const successRate = foundQueries.length / queryResults.length;

    results.push({
      sourceDoc,
      queries: queryResults,
      avgRank,
      avgScore,
      successRate,
      bestRank: Math.min(...queryResults.map(q => q.rank > 0 ? q.rank : Infinity)),
      worstRank: Math.max(...queryResults.map(q => q.rank)),
      failedQueries: queryResults.filter(q => q.rank === 0).length
    });
  }

  // Calculate global metrics
  const summary = calculateMetrics(results);

  // Identify failures (documents not found in top-K for any query)
  const failures = results.filter(r => r.failedQueries > 0);
  const totalFailures = results.filter(r => r.successRate === 0);

  // NEW: Analyze failure patterns
  const failurePatterns = {
    byKind: {},
    byTitleLength: { '0-10': 0, '10-20': 0, '20-50': 0, '50+': 0 },
    byContentLength: {}, // Will be calculated if content data available
    avgScoreOfFailures: 0,
    avgLexicalOverlapFailures: 0,
    avgLexicalOverlapSuccess: 0
  };

  totalFailures.forEach(f => {
    const kind = f.sourceDoc.kind;
    failurePatterns.byKind[kind] = (failurePatterns.byKind[kind] || 0) + 1;

    const titleLen = (f.sourceDoc.title || '').length;
    if (titleLen <= 10) failurePatterns.byTitleLength['0-10']++;
    else if (titleLen <= 20) failurePatterns.byTitleLength['10-20']++;
    else if (titleLen <= 50) failurePatterns.byTitleLength['20-50']++;
    else failurePatterns.byTitleLength['50+']++;
  });

  // Calculate average scores and lexical overlap for failures vs successes
  const allFailedQueries = results.flatMap(r => r.queries.filter(q => q.rank === 0));
  const allSuccessQueries = results.flatMap(r => r.queries.filter(q => q.rank > 0));

  if (allFailedQueries.length > 0) {
    failurePatterns.avgScoreOfFailures = allFailedQueries
      .filter(q => q.score !== null)
      .reduce((sum, q) => sum + (q.score || 0), 0) / Math.max(1, allFailedQueries.filter(q => q.score).length);

    failurePatterns.avgLexicalOverlapFailures = allFailedQueries
      .reduce((sum, q) => sum + (q.lexicalOverlap || 0), 0) / allFailedQueries.length;
  }

  if (allSuccessQueries.length > 0) {
    failurePatterns.avgLexicalOverlapSuccess = allSuccessQueries
      .reduce((sum, q) => sum + (q.lexicalOverlap || 0), 0) / allSuccessQueries.length;
  }

  console.log(`[runQualityTests] Completed: ${summary.totalQueries} queries tested`);
  console.log(`  Success Rate (Top-3): ${(summary.successRate_top3 * 100).toFixed(1)}%`);
  console.log(`  Success Rate (Top-5): ${(summary.successRate_top5 * 100).toFixed(1)}%`);
  console.log(`  Success Rate (Top-10): ${(summary.successRate_top10 * 100).toFixed(1)}%`);
  console.log(`  Hit Rate: ${(summary.hitRate * 100).toFixed(1)}%`);
  console.log(`  MRR: ${summary.mrr.toFixed(3)}`);
  console.log(`  Avg Rank: ${summary.avgRank.toFixed(2)}`);
  console.log(`  Avg Score: ${summary.avgScore.toFixed(3)}`);
  console.log(`  Partial Failures: ${failures.length} documents with some failed queries`);
  console.log(`  Total Failures: ${totalFailures.length} documents not found at all`);
  console.log(`  Failure patterns:`, JSON.stringify(failurePatterns, null, 2));

  return {
    tests: results,
    summary,
    failures: failures.map(f => ({
      sourceDoc: f.sourceDoc,
      failedQueries: f.queries.filter(q => q.rank === 0),
      avgRank: f.avgRank,
      successRate: f.successRate
    })),
    totalFailures: totalFailures.map(f => ({
      sourceDoc: f.sourceDoc,
      queries: f.queries
    })),
    failurePatterns, // NEW: Machine-readable failure analysis
    config: {
      limit,
      timestamp: new Date(),
      totalTests: testDataset.length,
      totalQueries: summary.totalQueries
    }
  };
};
