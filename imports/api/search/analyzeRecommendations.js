// Automatic analysis and recommendations based on quality test results

export const analyzeRecommendations = (testResults) => {
  const recommendations = [];
  const { summary, failurePatterns, config, tests } = testResults;

  // Recommendation 1: Increase search limit if many docs found outside top-K
  if (summary.hitRate - summary.successRate_top10 > 0.15) {
    const docsFoundOutside = Math.round((summary.hitRate - summary.successRate_top10) * summary.totalQueries);
    recommendations.push({
      type: 'increase_limit',
      priority: 'high',
      reason: `${docsFoundOutside} documents found outside top-${config.limit} (in positions ${config.limit + 1}-50)`,
      code: {
        file: 'imports/api/tools/handlers.js',
        line: 169,
        current: `const limit = Math.max(1, Math.min(50, Number(args?.limit) || 8));`,
        suggested: `const limit = Math.max(1, Math.min(50, Number(args?.limit) || ${config.limit + 5}));`
      },
      currentValue: config.limit,
      suggestedValue: config.limit + 5,
      expectedImpact: `+${((summary.hitRate - summary.successRate_top10) * 100).toFixed(1)}% success rate`
    });
  }

  // Recommendation 2: Check embedding quality if avg scores are low
  if (summary.avgScore < 0.55) {
    recommendations.push({
      type: 'improve_embeddings',
      priority: 'high',
      reason: `Average similarity score is low (${summary.avgScore.toFixed(3)}). This indicates weak embeddings.`,
      suggestions: [
        {
          action: 'Switch to larger embedding model',
          code: {
            file: 'imports/ui/Preferences/Preferences.jsx',
            hint: 'Change Remote AI → Embedding Model from text-embedding-3-small to text-embedding-3-large'
          },
          expectedImpact: 'Better semantic understanding, +10-20% success rate'
        },
        {
          action: 'Reindex with current model',
          code: {
            file: 'Preferences → Qdrant → Rebuild index',
            meteor: `Meteor.call('qdrant.indexStart')`
          },
          expectedImpact: 'Ensure all docs are properly indexed'
        }
      ]
    });
  }

  // Recommendation 3: Analyze lexical overlap gap
  if (failurePatterns.avgLexicalOverlapSuccess - failurePatterns.avgLexicalOverlapFailures > 0.2) {
    recommendations.push({
      type: 'vocabulary_mismatch',
      priority: 'medium',
      reason: `Successful queries have ${(failurePatterns.avgLexicalOverlapSuccess * 100).toFixed(0)}% lexical overlap vs ${(failurePatterns.avgLexicalOverlapFailures * 100).toFixed(0)}% for failures. Users search with different words than document content.`,
      suggestions: [
        {
          action: 'Add synonyms or stemming',
          hint: 'Consider preprocessing that normalizes vocabulary (e.g., "budget" → "budgeting")'
        },
        {
          action: 'Improve document titles',
          hint: 'Add descriptive keywords to titles that users would search for'
        }
      ]
    });
  }

  // Recommendation 4: Check specific kinds with high failure rates
  Object.entries(failurePatterns.byKind || {}).forEach(([kind, count]) => {
    const totalOfKind = tests.filter(t => t.sourceDoc.kind === kind).length;
    const failureRate = count / totalOfKind;

    if (failureRate > 0.5 && count >= 3) {
      recommendations.push({
        type: 'reindex_kind',
        priority: 'high',
        reason: `${kind} documents have ${(failureRate * 100).toFixed(0)}% failure rate (${count}/${totalOfKind} docs failed)`,
        affectedDocs: tests
          .filter(t => t.sourceDoc.kind === kind && t.successRate === 0)
          .map(t => `${t.sourceDoc.kind}:${t.sourceDoc.id}`),
        action: {
          meteor: `Meteor.call('qdrant.indexKind', '${kind}')`,
          ui: `Preferences → Qdrant → Rebuild by kind → Select "${kind}"`
        },
        expectedImpact: `Fix indexing issues for ${kind} documents`
      });
    }
  });

  // Recommendation 5: Check title length correlation
  const shortTitleFailures = failurePatterns.byTitleLength['0-10'] || 0;
  const totalShortTitles = tests.filter(t => (t.sourceDoc.title || '').length <= 10).length;

  if (shortTitleFailures > 0 && totalShortTitles > 0) {
    const shortTitleFailureRate = shortTitleFailures / totalShortTitles;
    if (shortTitleFailureRate > 0.6) {
      recommendations.push({
        type: 'improve_content',
        priority: 'medium',
        reason: `Documents with short titles (≤10 chars) have ${(shortTitleFailureRate * 100).toFixed(0)}% failure rate (${shortTitleFailures}/${totalShortTitles} docs)`,
        suggestions: [
          {
            action: 'Add more descriptive titles',
            hint: 'Short titles like "Q1" or "Budget" don\'t provide enough semantic signal'
          },
          {
            action: 'Ensure content field is populated',
            hint: 'If title is short, make sure content/notes field has substantial text'
          }
        ],
        affectedDocs: tests
          .filter(t => (t.sourceDoc.title || '').length <= 10 && t.successRate === 0)
          .map(t => ({ id: `${t.sourceDoc.kind}:${t.sourceDoc.id}`, title: t.sourceDoc.title }))
      });
    }
  }

  // Recommendation 6: Overall quality assessment
  if (summary.successRate_top10 >= 0.8) {
    recommendations.push({
      type: 'quality_ok',
      priority: 'info',
      reason: `Search quality is good (${(summary.successRate_top10 * 100).toFixed(1)}% success rate)`,
      suggestions: [
        {
          action: 'Current limit adequate',
          hint: `limit=${config.limit} seems appropriate for your use case`
        }
      ]
    });
  } else if (summary.successRate_top10 < 0.5) {
    recommendations.push({
      type: 'critical_issue',
      priority: 'critical',
      reason: `Search quality is poor (${(summary.successRate_top10 * 100).toFixed(1)}% success rate). This will significantly impact LLM/MCP functionality.`,
      urgentActions: [
        'Check Qdrant health: Meteor.call("qdrant.health")',
        'Verify embeddings are being generated: Check server logs for errors',
        'Rebuild index: Meteor.call("qdrant.indexStart")',
        'Consider switching AI mode (local ↔ remote)'
      ]
    });
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  recommendations.sort((a, b) => (priorityOrder[a.priority] || 5) - (priorityOrder[b.priority] || 5));

  return {
    recommendations,
    summary: {
      critical: recommendations.filter(r => r.priority === 'critical').length,
      high: recommendations.filter(r => r.priority === 'high').length,
      medium: recommendations.filter(r => r.priority === 'medium').length,
      totalIssues: recommendations.filter(r => r.priority !== 'info').length
    }
  };
};
