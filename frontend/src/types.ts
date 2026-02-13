export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  isAdmin?: boolean;
  isOnline?: boolean;
  lastSeen?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Project {
  _id: string;
  userId: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'done' | 'archived';
  targetDate: string | null;
  progressPercent: number;
  riskLevel: 'low' | 'medium' | 'high' | null;
  isFavorite: boolean;
  rank: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  _id: string;
  userId: string;
  projectId: string | null;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  urgent: boolean;
  important: boolean;
  deadline: string | null;
  scheduledDate: string | null;
  estimate: number | null;
  actual: number | null;
  progressPercent: number;
  rank: number;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  _id: string;
  userId: string;
  projectId: string | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSession {
  _id: string;
  userId: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteLine {
  _id: string;
  userId: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

export interface Person {
  _id: string;
  userId: string;
  name: string;
  lastName: string;
  normalizedName: string;
  aliases: string[];
  email: string;
  role: string;
  notes: string;
  left: boolean;
  contactOnly: boolean;
  teamId: string | null;
  subteam: string;
  arrivalDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  _id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Link {
  _id: string;
  userId: string;
  projectId: string | null;
  name: string;
  url: string;
  clicksCount: number;
  lastClickedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileDoc {
  _id: string;
  userId: string;
  projectId: string | null;
  name: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  clicksCount: number;
  lastClickedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Alarm {
  _id: string;
  userId: string;
  title: string;
  enabled: boolean;
  nextTriggerAt: string;
  recurrence: {
    type: 'none' | 'daily' | 'weekly' | 'monthly';
    daysOfWeek?: number[];
  };
  snoozedUntilAt: string | null;
  done: boolean;
  acknowledgedAt: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetLine {
  _id: string;
  userId: string;
  date: string;
  vendor: string;
  category: string;
  amountCents: number;
  vatCents: number;
  currency: string;
  projectId: string | null;
  invoiceNumber: string;
  notes: string;
  importBatch: string;
  importFile: string;
  department: string;
  team: string;
  dedupeHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetSummary {
  _id: { month: string; department: string };
  totalCents: number;
  vatCents: number;
  count: number;
}

export interface CalendarEvent {
  _id: string;
  userId: string;
  uid: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  source: 'ics' | 'google' | 'manual';
  calendarId: string;
  htmlLink: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Situation {
  _id: string;
  userId: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface SituationActor {
  _id: string;
  situationId: string;
  personId: string | null;
  name: string;
  role: string;
  situationRole: string;
}

export interface SituationNote {
  _id: string;
  situationId: string;
  actorId: string | null;
  content: string;
  createdAt: string;
}

export interface SituationSummary {
  _id: string;
  situationId: string;
  text: string;
  createdAt: string;
}

export interface UserLog {
  _id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface MCPServer {
  _id: string;
  userId: string;
  name: string;
  type: 'stdio' | 'http';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  lastConnectedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotionIntegration {
  _id: string;
  userId: string;
  name: string;
  databaseId: string;
  description?: string;
  filters: {
    squadName?: string;
    lifecycle?: string[];
    ownerIds?: string[];
  };
  ownerMapping?: Record<string, string>;
  pageSize: number;
  enabled: boolean;
  lastSyncAt?: string;
  syncInProgress: boolean;
  syncProgress?: {
    current: number;
    pageCount: number;
    status: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface NotionTicket {
  _id: string;
  integrationId: string;
  notionId: string;
  ticketId?: number;
  title: string;
  owners: { id: string; name: string }[];
  age?: string;
  priority?: string;
  lifecycle?: string;
  nextStep?: string;
  url?: string;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface GmailStatus {
  connected: boolean;
  oauthConfigured: boolean;
  expiryDate?: number;
}

export interface GmailMessage {
  _id: string;
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  body?: string;
  snippet?: string;
  labelIds: string[];
  gmailDate: string;
  isRead: boolean;
  isImportant: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GmailStats {
  total: number;
  unread: number;
  inbox: number;
  archived: number;
}

// Claude Code types

export interface ClaudeProject {
  _id: string;
  userId: string;
  name: string;
  cwd: string;
  model: string;
  permissionMode: string;
  appendSystemPrompt: string;
  linkedProjectId: string | null;
  claudeEffort: string;
  codexModel: string;
  codexReasoningEffort: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeSession {
  _id: string;
  userId: string;
  projectId: string;
  name: string;
  cwd: string;
  model: string;
  permissionMode: string;
  appendSystemPrompt: string;
  claudeSessionId: string | null;
  claudeCodeVersion: string;
  activeModel: string;
  activeAgent: string;
  status: 'idle' | 'running' | 'error';
  pid: number | null;
  lastError: string | null;
  totalCostUsd: number;
  totalDurationMs: number;
  lastModelUsage: Record<string, unknown>;
  queuedCount: number;
  unseenCompleted: boolean;
  claudeEffort: string;
  codexModel: string;
  codexReasoningEffort: string;
  codexRunning: boolean;
  debateRunning: boolean;
  debateRound: number | null;
  debateCurrentAgent: string | null;
  debateSubject: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  source?: { type: string; media_type: string; data: string };
  tool_use_id?: string;
}

export interface ClaudeMessage {
  _id: string;
  sessionId: string;
  role: string;
  type: string;
  content: ClaudeContentBlock[];
  contentText: string;
  claudeSessionId: string;
  model: string;
  isStreaming: boolean;
  durationMs: number;
  usage: Record<string, unknown>;
  costUsd: number;
  queued: boolean;
  toolName: string;
  toolInput: Record<string, unknown>;
  autoResponded: boolean;
  autoRespondedMode: string;
  shellCommand: string;
  shellExitCode: number | null;
  debateAgent: string;
  debateRound: number;
  debateAgreed: boolean | null;
  debateRounds: number;
  debateOutcome: string;
  createdAt: string;
}

export interface SearchResult {
  score: number;
  payload: Record<string, unknown>;
}

export interface OverviewData {
  projects: {
    total: number;
    active: number;
    recent: Pick<Project, '_id' | 'name' | 'status' | 'updatedAt' | 'isFavorite'>[];
  };
  tasks: {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    urgent: number;
    withDeadline: number;
    recent: Pick<Task, '_id' | 'title' | 'status' | 'urgent' | 'important' | 'deadline' | 'projectId'>[];
  };
  notes: {
    total: number;
  };
}
