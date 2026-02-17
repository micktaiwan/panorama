// Automated fix for indexing issues
// This script identifies missing documents and reindexes them

import { getQdrantClient, COLLECTION, toPointId, upsertDoc, upsertDocChunks } from './vectorStore';

/**
 * Auto-fix indexing issues by checking which documents are missing from Qdrant
 * and reindexing only those documents
 * @param {Object} opts - Options
 * @param {boolean} opts.dryRun - If true, only report what would be fixed (don't actually fix)
 * @param {number} opts.sampleSize - Number of documents per kind to check (default: 100, 0 = all)
 * @returns {Object} Report of what was fixed
 */
export const autoFixIndexing = async (opts = {}) => {
  const dryRun = !!opts.dryRun;
  const userId = opts.userId || null;
  const sampleSize = opts.sampleSize === 0 ? 0 : Math.max(5, Math.min(1000, Number(opts?.sampleSize) || 100));

  const report = {
    dryRun,
    checked: {},
    missing: {},
    fixed: {},
    errors: []
  };

  try {
    const client = await getQdrantClient();
    const collectionName = COLLECTION();

    // Check if collection exists
    try {
      await client.getCollection(collectionName);
    } catch (_err) {
      report.errors.push({
        type: 'collection_not_found',
        message: `Qdrant collection "${collectionName}" does not exist. Run full reindex.`,
        action: 'Meteor.call("qdrant.indexStart")'
      });
      return report;
    }

    // Import collections
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const { GmailMessagesCollection } = await import('/imports/api/emails/collections');

    // Check and fix each kind
    const kindConfigs = [
      {
        kind: 'project',
        collection: ProjectsCollection,
        fields: { name: 1, description: 1, _id: 1 },
        getText: (doc) => `${doc.name || ''} ${doc.description || ''}`
      },
      {
        kind: 'task',
        collection: TasksCollection,
        fields: { title: 1, notes: 1, projectId: 1, _id: 1 },
        getText: (doc) => `${doc.title || ''} ${doc.notes || ''}`
      },
      {
        kind: 'note',
        collection: NotesCollection,
        fields: { title: 1, content: 1, projectId: 1, _id: 1 },
        getText: (doc) => `${doc.title || ''} ${doc.content || ''}`,
        chunked: true
      },
      {
        kind: 'email',
        collection: GmailMessagesCollection,
        fields: { id: 1, from: 1, to: 1, subject: 1, snippet: 1, body: 1, threadId: 1 },
        getText: (doc) => `${doc.from || ''} ${doc.to || ''} ${doc.subject || ''} ${doc.snippet || ''} ${doc.body || ''}`,
        chunked: true,
        idField: 'id' // Use Gmail message ID instead of MongoDB _id
      }
    ];

    for (const config of kindConfigs) {
      const { kind, collection, fields, getText, chunked, idField = '_id' } = config;

      // Get documents from database
      const query = {};
      const options = { fields };
      if (sampleSize > 0) {
        options.limit = sampleSize;
      }

      const docs = await collection.find(query, options).fetchAsync();
      report.checked[kind] = docs.length;

      if (docs.length === 0) {
        continue;
      }

      // Check which documents are missing from Qdrant
      const missing = [];

      for (const doc of docs) {
        const text = getText(doc);
        if (!text || !text.trim()) {
          continue; // Skip empty documents
        }

        // For chunked documents, check first chunk (id#0); for others, check id directly
        const docId = doc[idField];
        const pointId = chunked ? toPointId(kind, `${docId}#0`) : toPointId(kind, docId);

        try {
          const res = await client.retrieve(collectionName, { ids: [pointId], with_payload: false, with_vector: false });
          const points = Array.isArray(res) ? res : (res?.result || []);
          if (points.length === 0) {
            missing.push(doc);
          }
        } catch (_err) {
          // If retrieve fails, assume document is missing
          missing.push(doc);
        }
      }

      report.missing[kind] = missing.length;

      // If not dry run, reindex missing documents using shared upsert helpers
      if (!dryRun && missing.length > 0) {
        let fixedCount = 0;
        const errors = [];

        for (const doc of missing) {
          try {
            const text = getText(doc);
            const docId = doc[idField];
            const extraPayload = doc.threadId ? { threadId: doc.threadId } : {};

            if (chunked) {
              await upsertDocChunks({ kind, id: docId, text, projectId: doc.projectId || null, userId, extraPayload });
            } else {
              await upsertDoc({ kind, id: docId, text, projectId: doc.projectId || null, userId, extraPayload });
            }
            fixedCount++;
          } catch (e) {
            errors.push({
              kind,
              id: doc[idField],
              error: e.message
            });
          }
        }

        report.fixed[kind] = fixedCount;
        if (errors.length > 0) {
          report.errors.push(...errors);
        }
      }
    }

    // Generate summary recommendations
    const totalMissing = Object.values(report.missing).reduce((sum, count) => sum + count, 0);
    const totalChecked = Object.values(report.checked).reduce((sum, count) => sum + count, 0);

    report.summary = {
      totalChecked,
      totalMissing,
      percentageMissing: totalChecked > 0 ? ((totalMissing / totalChecked) * 100).toFixed(1) : '0.0',
      recommendation: totalMissing === 0
        ? 'All sampled documents are properly indexed'
        : dryRun
          ? `Run with dryRun=false to reindex ${totalMissing} missing documents`
          : `Successfully reindexed ${Object.values(report.fixed).reduce((s, c) => s + c, 0)} documents`
    };

  } catch (error) {
    report.errors.push({
      type: 'fatal',
      message: error.message,
      stack: error.stack
    });
  }

  return report;
};
