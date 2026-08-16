// Diagnostic tool to check Qdrant indexing health
// This script cross-references database documents with Qdrant index

import { getQdrantClient, COLLECTION, toPointId } from './vectorStore';

// Notes and emails are indexed as chunks: the point for the first chunk is
// `<id>#0`, never the bare id. Checking the bare id reports every note and
// every email as missing.
const CHUNKED_KINDS = new Set(['note', 'email', 'line']);

const pointIdFor = (kind, docId) => (
  CHUNKED_KINDS.has(kind) ? toPointId(kind, `${docId}#0`) : toPointId(kind, docId)
);

export const diagnoseIndexing = async ({ userId = null } = {}) => {
  const diagnosis = {
    userId,
    qdrant: {},
    database: {},
    missing: {},
    recommendations: []
  };
  // Every collection is userId-partitioned: a diagnosis that counts all users'
  // documents against one user's points compares two different populations.
  const sel = userId ? { userId } : {};

  try {
    // 1. Check Qdrant health
    const client = await getQdrantClient();
    const collectionName = COLLECTION();
    const userFilter = userId ? { must: [{ key: 'userId', match: { value: userId } }] } : undefined;

    try {
      const collectionInfo = await client.getCollection(collectionName);
      const countRes = await client.count(collectionName, { exact: true, ...(userFilter ? { filter: userFilter } : {}) });
      const count = countRes?.result?.count ?? countRes?.count ?? 0;
      const allRes = await client.count(collectionName, { exact: true });
      const countAllUsers = allRes?.result?.count ?? allRes?.count ?? 0;

      diagnosis.qdrant = {
        collection: collectionName,
        exists: true,
        count,
        countAllUsers,
        status: collectionInfo?.status,
        vectorSize: collectionInfo.config?.params?.vectors?.size ?? collectionInfo.config?.params?.vectors?.config?.size
      };
    } catch (e) {
      diagnosis.qdrant = {
        collection: collectionName,
        exists: false,
        error: e.message
      };
    }

    // 2. Count documents in database
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const { TasksCollection, NOT_DELETED } = await import('/imports/api/tasks/collections');
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
    const { LinksCollection } = await import('/imports/api/links/collections');
    const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
    const { GmailMessagesCollection } = await import('/imports/api/emails/collections');

    const projectCount = await ProjectsCollection.find(sel).countAsync();
    const taskCount = await TasksCollection.find({ ...sel, ...NOT_DELETED }).countAsync();
    const noteCount = await NotesCollection.find(sel).countAsync();
    const sessionCount = await NoteSessionsCollection.find(sel).countAsync();
    const linkCount = await LinksCollection.find(sel).countAsync();
    const userLogCount = await UserLogsCollection.find(sel).countAsync();
    const emailCount = await GmailMessagesCollection.find(sel).countAsync();

    diagnosis.database = {
      projects: projectCount,
      tasks: taskCount,
      notes: noteCount,
      sessions: sessionCount,
      links: linkCount,
      userLogs: userLogCount,
      emails: emailCount,
      total: projectCount + taskCount + noteCount + sessionCount + linkCount + userLogCount + emailCount
    };

    // 3. If Qdrant exists, check for missing documents
    if (diagnosis.qdrant.exists) {
      const missing = {};

      // Sample check: verify the most recent documents of each kind exist in
      // Qdrant. Documents with no indexable text are skipped: they are absent
      // on purpose, not missing.
      const checkKind = async ({ collection, kind, limit = 5, idField = '_id', fields = {}, sort, extraSelector, getText }) => {
        // Newest first: recently created documents are the ones a stale index misses.
        const selector = { ...sel, ...(extraSelector || {}) };
        const docs = await collection.find(selector, { limit, sort, fields: { [idField]: 1, ...fields } }).fetchAsync();
        const notFound = [];
        let checked = 0;

        for (const doc of docs) {
          const text = getText ? getText(doc) : 'x';
          if (!String(text || '').trim()) continue;
          checked += 1;
          const docId = doc[idField];
          try {
            const res = await client.retrieve(collectionName, { ids: [pointIdFor(kind, docId)] });
            const point = Array.isArray(res) ? res : (res?.result || []);
            if (point.length === 0) {
              notFound.push(docId);
            }
          } catch (_err) {
            notFound.push(docId);
          }
        }

        return { checked, notFound };
      };

      if (projectCount > 0) {
        missing.projects = await checkKind({
          collection: ProjectsCollection, kind: 'project',
          fields: { name: 1, description: 1 }, sort: { createdAt: -1 },
          getText: (d) => `${d.name || ''} ${d.description || ''}`
        });
      }
      if (taskCount > 0) {
        missing.tasks = await checkKind({
          collection: TasksCollection, kind: 'task',
          // Trashed tasks are not indexed on purpose; sampling them would report
          // a correct exclusion as a missing document.
          extraSelector: NOT_DELETED,
          fields: { title: 1, notes: 1 }, sort: { createdAt: -1 },
          getText: (d) => `${d.title || ''} ${d.notes || ''}`
        });
      }
      if (noteCount > 0) {
        missing.notes = await checkKind({
          collection: NotesCollection, kind: 'note',
          fields: { title: 1, content: 1 }, sort: { updatedAt: -1 },
          getText: (d) => `${d.title || ''} ${d.content || ''}`
        });
      }
      if (emailCount > 0) {
        missing.emails = await checkKind({
          collection: GmailMessagesCollection, kind: 'email', idField: 'id',
          fields: { subject: 1, snippet: 1, body: 1 }, sort: { gmailDate: -1 },
          getText: (d) => `${d.subject || ''} ${d.snippet || ''} ${d.body || ''}`
        });
      }

      diagnosis.missing = missing;
    }

    // 4. Generate recommendations
    if (!diagnosis.qdrant.exists) {
      diagnosis.recommendations.push({
        priority: 'critical',
        issue: 'Qdrant collection does not exist',
        action: 'Create collection and index all documents',
        meteorCall: 'Meteor.call("qdrant.indexStart")',
        mcpTool: 'tool_searchReindex'
      });
    } else if (diagnosis.qdrant.count === 0) {
      diagnosis.recommendations.push({
        priority: 'critical',
        issue: 'Qdrant collection exists but has 0 documents indexed for this user',
        action: 'Index all documents',
        meteorCall: 'Meteor.call("qdrant.indexStart")',
        mcpTool: 'tool_searchReindex'
      });
    } else {
      // Coverage is points/documents: notes and emails produce several points
      // each, so a ratio above 1 is normal and only a low ratio is a signal.
      const expectedMin = diagnosis.database.total;
      const actualCount = diagnosis.qdrant.count;
      const coverage = expectedMin > 0 ? actualCount / expectedMin : 1;

      if (coverage < 0.5) {
        diagnosis.recommendations.push({
          priority: 'high',
          issue: `Only ${(coverage * 100).toFixed(1)}% of documents have a vector (${actualCount} points / ${expectedMin} documents)`,
          action: 'Rebuild index to ensure all documents are included',
          meteorCall: 'Meteor.call("qdrant.indexStart")',
          mcpTool: 'tool_searchReindex'
        });
      }

      // Check specific kinds
      Object.entries(diagnosis.missing || {}).forEach(([kind, result]) => {
        if (result.checked > 0 && result.notFound.length > 0) {
          const rate = (result.notFound.length / result.checked) * 100;
          const singular = kind.replace(/ies$/, 'y').replace(/s$/, '');
          diagnosis.recommendations.push({
            priority: rate > 50 ? 'high' : 'medium',
            issue: `${rate.toFixed(0)}% of sampled ${kind} documents are not indexed (${result.notFound.length}/${result.checked})`,
            action: `Reindex ${kind} documents`,
            meteorCall: `Meteor.call("qdrant.indexKindStart", "${singular}")`,
            mcpTool: `tool_searchReindex {"kind":"${singular}"}`
          });
        }
      });
    }

    if (diagnosis.recommendations.length === 0) {
      diagnosis.recommendations.push({
        priority: 'info',
        issue: 'Indexing appears healthy',
        action: 'No action needed'
      });
    }

  } catch (error) {
    diagnosis.error = error.message;
    diagnosis.recommendations.push({
      priority: 'critical',
      issue: `Failed to diagnose indexing: ${error.message}`,
      action: 'Check Qdrant configuration and connectivity'
    });
  }

  return diagnosis;
};
