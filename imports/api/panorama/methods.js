import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { LinksCollection } from '/imports/api/links/collections';
import { UserLogsCollection } from '/imports/api/userLogs/collections';
import { GmailMessagesCollection } from '/imports/api/emails/collections';
import { AlarmsCollection } from '/imports/api/alarms/collections';
import { getHealthStatus, testProvider } from '/imports/api/_shared/llmProxy';
import { getAIConfig } from '/imports/api/_shared/config';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';

// Constants to replace magic numbers
const CONSTANTS = {
  DEFAULT_PERIOD_DAYS: 14,
  MIN_PERIOD_DAYS: 1,
  MAX_PERIOD_DAYS: 365,
  DUE_SOON_DAYS: 3,
  OVERDUE_PENALTY: 8,
  DORMANT_PENALTY: 20,
  NOTES_BONUS_MAX: 20,
  NOTES_BONUS_MULTIPLIER: 2
};

// Function to estimate token count based on text length
// Approximate estimation: 1 token ≈ 3.5 characters for French
const estimateTokens = (text) => {
  if (!text || typeof text !== 'string') return 0;
  // Normalize text (remove multiple spaces, etc.)
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  return Math.ceil(normalizedText.length / 3.5);
};

// Compute a simple health score based on overdue/dormancy and recent activity
const computeHealth = ({ t = {}, n = {}, dormant = false }) => {
  let score = 100;
  const overdue = Number(t.overdue || 0);
  const notes7d = Number(n.notes7d || 0);
  score -= overdue * CONSTANTS.OVERDUE_PENALTY;
  if (dormant) score -= CONSTANTS.DORMANT_PENALTY;
  score += Math.min(CONSTANTS.NOTES_BONUS_MAX, notes7d * CONSTANTS.NOTES_BONUS_MULTIPLIER);
  score = Math.max(0, Math.min(100, score));
  return { score };
};

// Helper to process tasks and calculate metrics
const processTasks = (allTasks, projectIds, since) => {
  const now = new Date();
  const soon = new Date(Date.now() + CONSTANTS.DUE_SOON_DAYS * 864e5);
  const tasksByProject = new Map();
  
  for (const t of allTasks) {
    const pid = t.projectId || '';
    if (!tasksByProject.has(pid)) tasksByProject.set(pid, { open: 0, overdue: 0, dueSoon: 0, lastTaskAt: null, next: [], changedInPeriod: 0 });
    const acc = tasksByProject.get(pid);
    const status = (t.status || 'todo');
    const isClosed = ['done', 'cancelled'].includes(status);
    if (!isClosed) acc.open += 1;
    const dl = t.deadline ? new Date(t.deadline) : null;
    if (!isClosed && dl && dl < now) acc.overdue += 1;
    if (!isClosed && dl && dl >= now && dl <= soon) acc.dueSoon += 1;
    const upd = t.updatedAt ? new Date(t.updatedAt) : null;
    const statusChanged = t.statusChangedAt ? new Date(t.statusChangedAt) : null;
    const created = t.createdAt ? new Date(t.createdAt) : null;
    const mostRecent = [upd, statusChanged, created].filter(Boolean).sort((a, b) => b - a)[0];
    if (mostRecent && (!acc.lastTaskAt || mostRecent > acc.lastTaskAt)) {
      acc.lastTaskAt = mostRecent;
    }
    // task heat within period
    const changedAt = t.statusChangedAt || t.updatedAt || t.createdAt || null;
    if (changedAt && new Date(changedAt) >= since) {
      acc.changedInPeriod = (acc.changedInPeriod || 0) + 1;
    }
    if (!isClosed) {
      const title = typeof t.title === 'string' ? t.title.trim() : '';
      if (title) acc.next.push({
        _id: t._id,
        title,
        deadline: t.deadline || null,
        status: t.status || 'todo',
        priorityRank: Number.isFinite(t.priorityRank) ? t.priorityRank : null,
        createdAt: t.createdAt || null
      });
    }
  }
  
  // Sort next tasks for each project
  for (const [, acc] of tasksByProject) {
    const toTime = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
    const statusRank = (s) => (s === 'in_progress' ? 0 : 1);
    acc.next.sort((a, b) => {
      const ad = toTime(a.deadline); const bd = toTime(b.deadline);
      if (ad !== bd) return ad - bd;
      const as = statusRank(a.status || 'todo'); const bs = statusRank(b.status || 'todo');
      if (as !== bs) return as - bs;
      const ar = Number.isFinite(a.priorityRank) ? a.priorityRank : Number.POSITIVE_INFINITY;
      const br = Number.isFinite(b.priorityRank) ? b.priorityRank : Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ac - bc;
    });
    acc.next = acc.next.slice(0, 5);
  }
  
  return tasksByProject;
};

// Helper to process notes and calculate metrics
const processNotes = (notesAll, projectIds, since) => {
  const notesRecent = notesAll.filter(n => {
    const created = n.createdAt ? new Date(n.createdAt) : null;
    const updated = n.updatedAt ? new Date(n.updatedAt) : null;
    return (created && created >= since) || (updated && updated >= since);
  });
  const notesByProject = new Map();
  const notesLastByProject = new Map();
  
  for (const n of notesRecent) {
    const pid = n.projectId || '';
    if (!notesByProject.has(pid)) notesByProject.set(pid, { notes7d: 0 });
    const acc = notesByProject.get(pid);
    acc.notes7d += 1;
  }
  
  for (const n of notesAll) {
    const pid = n.projectId || '';
    const created = n.createdAt ? new Date(n.createdAt) : null;
    const updated = n.updatedAt ? new Date(n.updatedAt) : null;
    const mostRecent = [created, updated].filter(Boolean).sort((a, b) => b - a)[0];
    const prev = notesLastByProject.get(pid) || null;
    if (mostRecent && (!prev || mostRecent > prev)) {
      notesLastByProject.set(pid, mostRecent);
    }
  }
  
  return { notesByProject, notesLastByProject };
};

// Helper to calculate project activity and status
const calculateProjectActivity = (project, tasksData, notesData, notesLastByProject, periodDays) => {
  const t = tasksData.get(project._id) || { open: 0, overdue: 0, dueSoon: 0, next: [], lastTaskAt: null };
  const n = notesData.notesByProject.get(project._id) || { notes7d: 0 };
  const lastNoteAt = notesLastByProject.get(project._id) || null;
  
  // Add project creation date to lastNoteAt calculation
  const projectCreated = project.createdAt ? new Date(project.createdAt) : null;
  if (projectCreated && (!lastNoteAt || projectCreated > lastNoteAt)) {
    notesLastByProject.set(project._id, projectCreated);
  }
  
  const contentUpdatedAtTime = 0;
  const maxTime = Math.max(
    lastNoteAt ? lastNoteAt.getTime() : 0,
    t.lastTaskAt ? t.lastTaskAt.getTime() : 0,
    contentUpdatedAtTime,
    0 // avoid -Infinity
  );
  const lastActivityAt = maxTime > 0 ? new Date(maxTime) : null;
  
  // Improve isInactive logic - consider project creation date
  const projectAge = projectCreated ? (Date.now() - projectCreated.getTime()) : 0;
  const isNewProject = projectAge < (periodDays * 864e5); // Project created within the period
  const isInactive = !lastActivityAt || (!isNewProject && (Date.now() - lastActivityAt.getTime()) > (periodDays * 864e5));
  const health = computeHealth({ t, n, dormant: isInactive });
  
  return {
    lastActivityAt,
    isInactive,
    health,
    tasks: { open: t.open || 0, overdue: t.overdue || 0, dueSoon: t.dueSoon || 0, next: t.next || [] },
    notes: { lastStatusAt: null, decisions7d: 0, risks7d: 0 },
    heat: { notes: n.notes7d || 0, tasksChanged: t.changedInPeriod || 0 }
  };
};

Meteor.methods({
  async 'panorama.getOverview'(filters = {}) {
    check(filters, Object);
    
    // Validation for periodDays
    const periodDays = Number(filters.periodDays) || CONSTANTS.DEFAULT_PERIOD_DAYS;
    if (periodDays < CONSTANTS.MIN_PERIOD_DAYS || periodDays > CONSTANTS.MAX_PERIOD_DAYS) {
      throw new Meteor.Error('invalid-period', `periodDays must be between ${CONSTANTS.MIN_PERIOD_DAYS} and ${CONSTANTS.MAX_PERIOD_DAYS}`);
    }
    
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    // Fetch projects
    const projFields = { fields: { name: 1, tags: 1, updatedAt: 1, panoramaUpdatedAt: 1, targetDate: 1, status: 1, createdAt: 1, panoramaRank: 1, panoramaStatus: 1 } };
    const projects = await ProjectsCollection.find({}, projFields).fetchAsync();
    const projectIds = projects.map(p => p._id);

    // Early return if no projects
    if (projectIds.length === 0) {
      return [];
    }

    // Fetch and process tasks
    const taskFields = { fields: { projectId: 1, status: 1, deadline: 1, updatedAt: 1, title: 1, statusChangedAt: 1, createdAt: 1, priorityRank: 1 } };
    const allTasks = await TasksCollection.find({ projectId: { $in: projectIds } }, taskFields).fetchAsync();
    const tasksByProject = processTasks(allTasks, projectIds, since);

    // Fetch and process notes
    const noteFields = { fields: { projectId: 1, createdAt: 1, updatedAt: 1 } };
    const notesAll = await NotesCollection.find({ projectId: { $in: projectIds } }, noteFields).fetchAsync();
    const notesData = processNotes(notesAll, projectIds, since);

    // Add project creation date to lastNoteAt calculation
    for (const p of projects) {
      const pid = p._id;
      const projectCreated = p.createdAt ? new Date(p.createdAt) : null;
      const lastNoteAt = notesData.notesLastByProject.get(pid) || null;
      if (projectCreated && (!lastNoteAt || projectCreated > lastNoteAt)) {
        notesData.notesLastByProject.set(pid, projectCreated);
      }
    }

    // Compose output using helper
    return projects.map((p) => {
      const activity = calculateProjectActivity(p, tasksByProject, notesData, notesData.notesLastByProject, periodDays);
      return {
        _id: p._id,
        name: p.name || '(untitled project)',
        tags: p.tags || [],
        createdAt: p.createdAt || null,
        panoramaRank: Number.isFinite(p.panoramaRank) ? p.panoramaRank : null,
        panoramaStatus: typeof p.panoramaStatus === 'string' ? p.panoramaStatus : null,
        ...activity
      };
    });
  }
});

Meteor.methods({
  async 'panorama.setRank'(projectId, rank) {
    check(projectId, String);
    const n = Number(rank);
    if (!Number.isFinite(n)) throw new Meteor.Error('invalid-rank', 'rank must be a finite number');
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    // Do not touch updatedAt to avoid polluting last activity with UI reordering
    await ProjectsCollection.updateAsync(projectId, { $set: { panoramaRank: n, panoramaUpdatedAt: new Date() } });
    return true;
  },

  async 'ai.healthcheck'() {
    return await getHealthStatus();
  },

  async 'ai.testProvider'(provider, options = {}) {
    check(provider, String);
    check(options, Object);
    
    if (!['ollama', 'openai'].includes(provider)) {
      throw new Meteor.Error('invalid-provider', 'Provider must be "ollama" or "openai"');
    }
    
    return await testProvider(provider, options);
  },

  async 'ai.saveRemoteKey'(apiKey) {
    check(apiKey, String);
    
    if (!apiKey.trim()) {
      throw new Meteor.Error('invalid-key', 'API key cannot be empty');
    }
    
    // Store the key in Meteor.settings (server-side only)
    if (Meteor.settings) {
      if (!Meteor.settings.private) {
        Meteor.settings.private = {};
      }
      Meteor.settings.private.OPENAI_API_KEY = apiKey.trim();
    }
    
    // Also update in environment for immediate use
    process.env.OPENAI_API_KEY = apiKey.trim();
    
    return { success: true };
  },

  async 'ai.updatePreferences'(preferences) {
    check(preferences, Object);
    
    // Validate AI preferences structure
    const validModes = ['local', 'remote', 'auto'];
    const validFallbacks = ['none', 'local', 'remote'];
    
    if (preferences.mode && !validModes.includes(preferences.mode)) {
      throw new Meteor.Error('invalid-mode', 'Mode must be local, remote, or auto');
    }
    
    if (preferences.fallback && !validFallbacks.includes(preferences.fallback)) {
      throw new Meteor.Error('invalid-fallback', 'Fallback must be none, local, or remote');
    }
    
    // Update preferences
    const existing = await AppPreferencesCollection.findOneAsync({});
    if (existing) {
      await AppPreferencesCollection.updateAsync(existing._id, {
        $set: { ai: { ...existing.ai, ...preferences } }
      });
    } else {
      await AppPreferencesCollection.insertAsync({ ai: preferences });
    }
    
    return { success: true };
  },


  async 'ai.listOllamaModels'() {
    const config = getAIConfig();
    const host = config.local.host;
    
    const { default: fetch } = await import('node-fetch');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${host}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Meteor.Error('ollama-list-failed', `Failed to list Ollama models: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    const models = data.models?.map(model => ({
      name: model.name,
      model: model.model,
      size: model.size,
      parameterSize: model.details?.parameter_size,
      family: model.details?.family
    })) || [];
    
    return { models };
  },

  async 'panorama.countAllTokens'() {
    
    // Define collections and their text fields
    const collections = [
      { 
        name: 'Projects', 
        collection: ProjectsCollection, 
        fields: ['name', 'description'],
        description: 'Projects with name and description'
      },
      { 
        name: 'Tasks', 
        collection: TasksCollection, 
        fields: ['title', 'notes'],
        description: 'Tasks with title and notes'
      },
      { 
        name: 'Notes', 
        collection: NotesCollection, 
        fields: ['title', 'content'],
        description: 'Notes with title and content'
      },
      { 
        name: 'NoteSessions', 
        collection: NoteSessionsCollection, 
        fields: ['name', 'aiSummary'],
        description: 'Note sessions with name and AI summary'
      },
      { 
        name: 'NoteLines', 
        collection: NoteLinesCollection, 
        fields: ['content'],
        description: 'Note lines with content'
      },
      { 
        name: 'Links', 
        collection: LinksCollection, 
        fields: ['name', 'url'],
        description: 'Links with name and URL'
      },
      { 
        name: 'UserLogs', 
        collection: UserLogsCollection, 
        fields: ['content'],
        description: 'User logs with content'
      },
      { 
        name: 'GmailMessages', 
        collection: GmailMessagesCollection, 
        fields: ['from', 'to', 'subject', 'snippet', 'body'],
        description: 'Gmail messages with metadata and content'
      },
      { 
        name: 'Alarms', 
        collection: AlarmsCollection, 
        fields: ['title'],
        description: 'Alarms with title'
      }
    ];
    
    const results = {};
    let totalTokens = 0;
    let totalItems = 0;
    let totalCharacters = 0;
    
    for (const { name, collection, fields, description } of collections) {
      try {
        const items = await collection.find({}).fetchAsync();
        let collectionTokens = 0;
        let collectionCharacters = 0;
        let itemsWithContent = 0;
        
        for (const item of items) {
          // Concatenate all text fields of the item
          const text = fields
            .map(field => item[field] || '')
            .join(' ')
            .trim();
          
          if (text) {
            const tokens = estimateTokens(text);
            const characters = text.length;
            
            collectionTokens += tokens;
            collectionCharacters += characters;
            itemsWithContent += 1;
          }
        }
        
        results[name] = {
          description,
          totalItems: items.length,
          itemsWithContent,
          tokens: collectionTokens,
          characters: collectionCharacters,
          avgTokensPerItem: itemsWithContent > 0 ? Math.round(collectionTokens / itemsWithContent) : 0,
          avgCharsPerItem: itemsWithContent > 0 ? Math.round(collectionCharacters / itemsWithContent) : 0
        };
        
        totalTokens += collectionTokens;
        totalCharacters += collectionCharacters;
        totalItems += items.length;
        
      } catch (error) {
        console.error(`[panorama.countAllTokens] Error processing ${name}:`, error);
        results[name] = {
          description,
          error: error.message,
          totalItems: 0,
          itemsWithContent: 0,
          tokens: 0,
          characters: 0,
          avgTokensPerItem: 0,
          avgCharsPerItem: 0
        };
      }
    }
    
    // Calculate global statistics
    const globalStats = {
      totalCollections: collections.length,
      totalItems,
      totalTokens,
      totalCharacters,
      avgTokensPerItem: totalItems > 0 ? Math.round(totalTokens / totalItems) : 0,
      avgCharsPerItem: totalItems > 0 ? Math.round(totalCharacters / totalItems) : 0,
      tokensPerChar: totalCharacters > 0 ? (totalTokens / totalCharacters).toFixed(3) : 0
    };
    
    return {
      collections: results,
      globalStats,
      generatedAt: new Date().toISOString()
    };
  }
});


