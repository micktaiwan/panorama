// Generate test dataset from real data
// Analyzes existing documents and creates search queries that should find them

// Extract concepts from text (simple keyword extraction)
const extractConcepts = (text) => {
  const stopwords = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'et', 'ou', 'pour', 'dans', 'sur', 'avec',
    'par', 'ce', 'qui', 'que', 'est', 'sont', 'cette', 'ces', 'du', 'de', 'au', 'aux',
    'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'son', 'sa', 'ses', 'leur', 'leurs',
    'the', 'a', 'an', 'and', 'or', 'for', 'in', 'on', 'with', 'by', 'is', 'are', 'was',
    'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'must', 'can', 'to', 'from', 'of', 'at'
  ]);

  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Remove accents

  // Extract words (4+ chars, alphanumeric)
  const words = normalized.match(/\b[a-z0-9]{4,}\b/g) || [];

  // Count frequency
  const freq = {};
  words.forEach(w => {
    if (!stopwords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });

  // Return top 5 most frequent words
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
};

// Generate queries for a single document
const generateQueriesForDoc = ({ title, content }) => {
  const queries = [];

  // Query 1: Full title (if substantial)
  const titleTrimmed = String(title || '').trim();
  if (titleTrimmed.length >= 5) {
    queries.push({
      type: 'exact_title',
      query: titleTrimmed,
      description: 'Exact title match'
    });
  }

  // Query 2: First 3-4 words of title
  const titleWords = titleTrimmed.split(/\s+/).filter(Boolean);
  if (titleWords.length >= 3) {
    const partial = titleWords.slice(0, Math.min(4, titleWords.length)).join(' ');
    if (partial !== titleTrimmed && partial.length >= 5) {
      queries.push({
        type: 'partial_title',
        query: partial,
        description: 'Partial title (first words)'
      });
    }
  }

  // Query 3: Concept-based query from content
  if (content) {
    const concepts = extractConcepts(content);
    if (concepts.length >= 2) {
      const conceptQuery = concepts.slice(0, 3).join(' ');
      if (conceptQuery.length >= 5) {
        queries.push({
          type: 'concept',
          query: conceptQuery,
          description: `Content concepts: ${concepts.slice(0, 3).join(', ')}`
        });
      }
    }
  }

  // Query 4: Combined title + concept
  if (titleWords.length >= 1 && content) {
    const concepts = extractConcepts(content);
    if (concepts.length >= 1) {
      const hybrid = `${titleWords[0]} ${concepts[0]}`;
      if (hybrid.length >= 5 && !queries.some(q => q.query === hybrid)) {
        queries.push({
          type: 'hybrid',
          query: hybrid,
          description: 'Title word + content concept'
        });
      }
    }
  }

  return queries.filter(q => q.query && q.query.length >= 5);
};

// Generate test dataset from real database content
export const generateTestDataset = async ({ userId } = {}) => {
  const tests = [];
  const userFilter = userId ? { userId } : {};

  // 1. Sample notes (most recent with content)
  const { NotesCollection } = await import('/imports/api/notes/collections');
  const notes = await NotesCollection.find(
    {
      ...userFilter,
      $and: [
        { $or: [{ title: { $exists: true } }, { content: { $exists: true } }] },
        { $or: [{ title: { $ne: '' } }, { content: { $ne: '' } }] }
      ]
    },
    {
      limit: 10,
      sort: { updatedAt: -1 },
      fields: { title: 1, content: 1, projectId: 1 }
    }
  ).fetchAsync();

  for (const note of notes) {
    const contentPreview = String(note.content || '').slice(0, 1000); // Use first 1000 chars for concept extraction
    const queries = generateQueriesForDoc({
      kind: 'note',
      title: note.title,
      content: contentPreview
    });

    if (queries.length > 0) {
      tests.push({
        sourceDoc: {
          kind: 'note',
          id: note._id,
          title: note.title || '(untitled note)',
          projectId: note.projectId || null
        },
        queries
      });
    }
  }

  // 2. Sample tasks (with notes field)
  const { TasksCollection } = await import('/imports/api/tasks/collections');
  const tasks = await TasksCollection.find(
    {
      ...userFilter,
      title: { $exists: true, $ne: '' }
    },
    {
      limit: 10,
      sort: { createdAt: -1 },
      fields: { title: 1, notes: 1, projectId: 1 }
    }
  ).fetchAsync();

  for (const task of tasks) {
    const queries = generateQueriesForDoc({
      kind: 'task',
      title: task.title,
      content: task.notes || ''
    });

    if (queries.length > 0) {
      tests.push({
        sourceDoc: {
          kind: 'task',
          id: task._id,
          title: task.title,
          projectId: task.projectId || null
        },
        queries
      });
    }
  }

  // 3. Sample projects
  const { ProjectsCollection } = await import('/imports/api/projects/collections');
  const projects = await ProjectsCollection.find(
    {
      ...userFilter,
      name: { $exists: true, $ne: '' }
    },
    {
      limit: 5,
      sort: { createdAt: -1 },
      fields: { name: 1, description: 1 }
    }
  ).fetchAsync();

  for (const project of projects) {
    const queries = generateQueriesForDoc({
      kind: 'project',
      title: project.name,
      content: project.description || ''
    });

    if (queries.length > 0) {
      tests.push({
        sourceDoc: {
          kind: 'project',
          id: project._id,
          title: project.name,
          projectId: project._id
        },
        queries
      });
    }
  }

  // 4. Sample emails (to test vector indexing)
  const { GmailMessagesCollection } = await import('/imports/api/emails/collections');
  const emails = await GmailMessagesCollection.find(
    {
      ...userFilter,
      $and: [
        { subject: { $exists: true, $ne: '' } },
        { body: { $exists: true, $ne: '' } }
      ]
    },
    {
      limit: 10,
      sort: { gmailDate: -1 },
      fields: { id: 1, from: 1, subject: 1, snippet: 1, body: 1 }
    }
  ).fetchAsync();

  for (const email of emails) {
    // Use first 1000 chars of body + snippet for concept extraction
    const contentPreview = String(email.snippet || '') + ' ' + String(email.body || '').slice(0, 1000);
    const queries = generateQueriesForDoc({
      kind: 'email',
      title: email.subject,
      content: contentPreview
    });

    if (queries.length > 0) {
      tests.push({
        sourceDoc: {
          kind: 'email',
          id: email.id, // Use Gmail message ID (not MongoDB _id)
          title: email.subject || '(no subject)',
          from: email.from || '(unknown)'
        },
        queries
      });
    }
  }

  console.log(`[generateTestDataset] Generated ${tests.length} test cases from ${notes.length} notes, ${tasks.length} tasks, ${projects.length} projects, ${emails.length} emails`);

  return tests;
};
