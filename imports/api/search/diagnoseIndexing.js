// Diagnostic tool to check Qdrant indexing health
// This script cross-references database documents with Qdrant index

import { getQdrantClient, COLLECTION, toPointId } from './vectorStore';

export const diagnoseIndexing = async () => {
  const diagnosis = {
    qdrant: {},
    database: {},
    missing: {},
    recommendations: []
  };

  try {
    // 1. Check Qdrant health
    const client = await getQdrantClient();
    const collectionName = COLLECTION();

    try {
      const collectionInfo = await client.getCollection(collectionName);
      const countRes = await client.count(collectionName, { exact: true });
      const count = countRes?.result?.count ?? countRes?.count ?? 0;

      diagnosis.qdrant = {
        collection: collectionName,
        exists: true,
        count,
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
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
    const { LinksCollection } = await import('/imports/api/links/collections');
    const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
    const { GmailMessagesCollection } = await import('/imports/api/emails/collections');

    const projectCount = await ProjectsCollection.find().countAsync();
    const taskCount = await TasksCollection.find().countAsync();
    const noteCount = await NotesCollection.find().countAsync();
    const sessionCount = await NoteSessionsCollection.find().countAsync();
    const linkCount = await LinksCollection.find().countAsync();
    const userLogCount = await UserLogsCollection.find().countAsync();
    const emailCount = await GmailMessagesCollection.find().countAsync();

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

      // Sample check: verify first 5 documents of each kind exist in Qdrant
      const checkKind = async (collection, kind, limit = 5, idField = '_id') => {
        const docs = await collection.find({}, { limit, fields: { [idField]: 1 } }).fetchAsync();
        const notFound = [];

        for (const doc of docs) {
          const docId = doc[idField];
          const pointId = toPointId(kind, docId);
          try {
            const res = await client.retrieve(collectionName, { ids: [pointId] });
            const point = Array.isArray(res) ? res : (res?.result || []);
            if (point.length === 0) {
              notFound.push(docId);
            }
          } catch (_err) {
            notFound.push(docId);
          }
        }

        return { checked: docs.length, notFound };
      };

      if (projectCount > 0) {
        missing.projects = await checkKind(ProjectsCollection, 'project');
      }
      if (taskCount > 0) {
        missing.tasks = await checkKind(TasksCollection, 'task');
      }
      if (noteCount > 0) {
        missing.notes = await checkKind(NotesCollection, 'note');
      }
      if (emailCount > 0) {
        missing.emails = await checkKind(GmailMessagesCollection, 'email', 5, 'id');
      }

      diagnosis.missing = missing;
    }

    // 4. Generate recommendations
    if (!diagnosis.qdrant.exists) {
      diagnosis.recommendations.push({
        priority: 'critical',
        issue: 'Qdrant collection does not exist',
        action: 'Create collection and index all documents',
        meteorCall: 'Meteor.call("qdrant.indexStart")'
      });
    } else if (diagnosis.qdrant.count === 0) {
      diagnosis.recommendations.push({
        priority: 'critical',
        issue: 'Qdrant collection exists but has 0 documents indexed',
        action: 'Index all documents',
        meteorCall: 'Meteor.call("qdrant.indexStart")'
      });
    } else {
      // Check if significant portion is missing
      const expectedMin = diagnosis.database.total;
      const actualCount = diagnosis.qdrant.count;
      const coverage = actualCount / expectedMin;

      if (coverage < 0.5) {
        diagnosis.recommendations.push({
          priority: 'high',
          issue: `Only ${(coverage * 100).toFixed(1)}% of documents are indexed (${actualCount}/${expectedMin})`,
          action: 'Rebuild index to ensure all documents are included',
          meteorCall: 'Meteor.call("qdrant.indexStart")'
        });
      }

      // Check specific kinds
      Object.entries(diagnosis.missing || {}).forEach(([kind, result]) => {
        if (result.notFound.length > 0) {
          const rate = (result.notFound.length / result.checked) * 100;
          diagnosis.recommendations.push({
            priority: rate > 50 ? 'high' : 'medium',
            issue: `${rate.toFixed(0)}% of sampled ${kind} documents are not indexed (${result.notFound.length}/${result.checked})`,
            action: `Reindex ${kind} documents`,
            meteorCall: `Meteor.call("qdrant.indexKind", "${kind}")`
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
