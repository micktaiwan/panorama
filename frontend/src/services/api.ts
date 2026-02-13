import type { AuthResponse, Project, Task, Note, NoteSession, NoteLine, OverviewData, Person, Team, Link, FileDoc, Alarm, SearchResult, BudgetLine, BudgetSummary, CalendarEvent, Situation, SituationActor, SituationNote, SituationSummary, UserLog, MCPServer, NotionIntegration, NotionTicket, GmailStatus, GmailMessage, GmailStats, ClaudeProject, ClaudeSession, ClaudeMessage } from '../types';
import { isTauri } from '../platform/detect';

let apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002';

// Tauri desktop: relative URLs (/api) don't work — no nginx proxy in front
// Use local backend (for Claude CLI) connected to remote DB via SSH tunnel
if (isTauri() && apiBaseUrl.startsWith('/')) {
  apiBaseUrl = import.meta.env.VITE_API_URL_DESKTOP || 'http://localhost:3002';
}

export function setApiBaseUrl(url: string) {
  apiBaseUrl = url.replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export const auth = {
  register(data: { username: string; displayName: string; email: string; password: string }) {
    return request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) });
  },
  login(data: { username: string; password: string }) {
    return request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) });
  },
  me() {
    return request<{ user: AuthResponse['user'] }>('/auth/me');
  },
};

// Projects
export const projects = {
  list(params?: { status?: string; favorite?: boolean }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.favorite) query.set('favorite', 'true');
    const qs = query.toString();
    return request<{ projects: Project[] }>(`/projects${qs ? `?${qs}` : ''}`);
  },
  get(id: string) {
    return request<{ project: Project }>(`/projects/${id}`);
  },
  create(data: Partial<Project>) {
    return request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<Project>) {
    return request<{ project: Project }>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' });
  },
};

// Tasks
export const tasks = {
  list(params?: { projectId?: string; status?: string; urgent?: boolean; important?: boolean }) {
    const query = new URLSearchParams();
    if (params?.projectId) query.set('projectId', params.projectId);
    if (params?.status) query.set('status', params.status);
    if (params?.urgent) query.set('urgent', 'true');
    if (params?.important) query.set('important', 'true');
    const qs = query.toString();
    return request<{ tasks: Task[] }>(`/tasks${qs ? `?${qs}` : ''}`);
  },
  get(id: string) {
    return request<{ task: Task }>(`/tasks/${id}`);
  },
  create(data: Partial<Task>) {
    return request<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<Task>) {
    return request<{ task: Task }>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/tasks/${id}`, { method: 'DELETE' });
  },
};

// Notes
export const notes = {
  list(params?: { projectId?: string }) {
    const query = new URLSearchParams();
    if (params?.projectId) query.set('projectId', params.projectId);
    const qs = query.toString();
    return request<{ notes: Note[] }>(`/notes${qs ? `?${qs}` : ''}`);
  },
  get(id: string) {
    return request<{ note: Note }>(`/notes/${id}`);
  },
  create(data: Partial<Note>) {
    return request<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<Note>) {
    return request<{ note: Note }>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/notes/${id}`, { method: 'DELETE' });
  },
  // Sessions
  sessions: {
    list(params?: { projectId?: string }) {
      const query = new URLSearchParams();
      if (params?.projectId) query.set('projectId', params.projectId);
      const qs = query.toString();
      return request<{ sessions: NoteSession[] }>(`/notes/sessions${qs ? `?${qs}` : ''}`);
    },
    create(data: { projectId?: string }) {
      return request<{ session: NoteSession }>('/notes/sessions', { method: 'POST', body: JSON.stringify(data) });
    },
    delete(id: string) {
      return request<{ success: boolean }>(`/notes/sessions/${id}`, { method: 'DELETE' });
    },
  },
  // Lines
  lines: {
    list(sessionId: string) {
      return request<{ lines: NoteLine[] }>(`/notes/sessions/${sessionId}/lines`);
    },
    create(sessionId: string, data: { content: string }) {
      return request<{ line: NoteLine }>(`/notes/sessions/${sessionId}/lines`, { method: 'POST', body: JSON.stringify(data) });
    },
  },
};

// Overview / Dashboard
export const overview = {
  get() {
    return request<OverviewData>('/overview');
  },
};

// People
export const people = {
  list(params?: { teamId?: string; left?: boolean; contactOnly?: boolean; q?: string }) {
    const query = new URLSearchParams();
    if (params?.teamId) query.set('teamId', params.teamId);
    if (params?.left !== undefined) query.set('left', String(params.left));
    if (params?.contactOnly) query.set('contactOnly', 'true');
    if (params?.q) query.set('q', params.q);
    const qs = query.toString();
    return request<{ people: Person[] }>(`/people${qs ? `?${qs}` : ''}`);
  },
  get(id: string) {
    return request<{ person: Person }>(`/people/${id}`);
  },
  create(data: Partial<Person>) {
    return request<{ person: Person }>('/people', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<Person>) {
    return request<{ person: Person }>(`/people/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/people/${id}`, { method: 'DELETE' });
  },
};

// Teams
export const teams = {
  list() {
    return request<{ teams: Team[] }>('/teams');
  },
  get(id: string) {
    return request<{ team: Team }>(`/teams/${id}`);
  },
  create(data: { name: string }) {
    return request<{ team: Team }>('/teams', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: { name?: string }) {
    return request<{ team: Team }>(`/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/teams/${id}`, { method: 'DELETE' });
  },
  canRemove(id: string) {
    return request<{ canRemove: boolean; memberCount: number }>(`/teams/${id}/can-remove`);
  },
  reassign(id: string, newTeamId?: string) {
    return request<{ success: boolean }>(`/teams/${id}/reassign`, { method: 'POST', body: JSON.stringify({ newTeamId }) });
  },
};

// Links
export const links = {
  list(params?: { projectId?: string }) {
    const query = new URLSearchParams();
    if (params?.projectId) query.set('projectId', params.projectId);
    const qs = query.toString();
    return request<{ links: Link[] }>(`/links${qs ? `?${qs}` : ''}`);
  },
  get(id: string) {
    return request<{ link: Link }>(`/links/${id}`);
  },
  create(data: Partial<Link>) {
    return request<{ link: Link }>('/links', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<Link>) {
    return request<{ link: Link }>(`/links/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/links/${id}`, { method: 'DELETE' });
  },
  click(id: string) {
    return request<{ link: Link }>(`/links/${id}/click`, { method: 'POST' });
  },
};

// Files
export const files = {
  list(params?: { projectId?: string }) {
    const query = new URLSearchParams();
    if (params?.projectId) query.set('projectId', params.projectId);
    const qs = query.toString();
    return request<{ files: FileDoc[] }>(`/files${qs ? `?${qs}` : ''}`);
  },
  get(id: string) {
    return request<{ file: FileDoc }>(`/files/${id}`);
  },
  async upload(file: File, meta?: { name?: string; projectId?: string }) {
    const formData = new FormData();
    formData.append('file', file);
    if (meta?.name) formData.append('name', meta.name);
    if (meta?.projectId) formData.append('projectId', meta.projectId);

    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch(`${apiBaseUrl}/files`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ file: FileDoc }>;
  },
  update(id: string, data: { name?: string; projectId?: string | null }) {
    return request<{ file: FileDoc }>(`/files/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/files/${id}`, { method: 'DELETE' });
  },
  downloadUrl(id: string) {
    return `${apiBaseUrl}/files/${id}/download`;
  },
};

// Alarms
export const alarms = {
  list() {
    return request<{ alarms: Alarm[] }>('/alarms');
  },
  due() {
    return request<{ alarms: Alarm[] }>('/alarms/due');
  },
  get(id: string) {
    return request<{ alarm: Alarm }>(`/alarms/${id}`);
  },
  create(data: Partial<Alarm>) {
    return request<{ alarm: Alarm }>('/alarms', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<Alarm>) {
    return request<{ alarm: Alarm }>(`/alarms/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/alarms/${id}`, { method: 'DELETE' });
  },
  snooze(id: string, minutes: number) {
    return request<{ alarm: Alarm }>(`/alarms/${id}/snooze`, { method: 'POST', body: JSON.stringify({ minutes }) });
  },
  dismiss(id: string) {
    return request<{ alarm: Alarm }>(`/alarms/${id}/dismiss`, { method: 'POST' });
  },
};

// Search
export const search = {
  query(q: string, params?: { kind?: string; projectId?: string; limit?: number }) {
    const query = new URLSearchParams();
    query.set('q', q);
    if (params?.kind) query.set('kind', params.kind);
    if (params?.projectId) query.set('projectId', params.projectId);
    if (params?.limit) query.set('limit', String(params.limit));
    return request<{ query: string; results: SearchResult[]; count: number }>(`/search?${query}`);
  },
  aiStatus() {
    return request<{ mode: string; providers: unknown; qdrant: unknown; models: unknown }>('/search/ai-status');
  },
};

// Budget
export const budget = {
  list(params?: { from?: string; to?: string; department?: string; vendor?: string }) {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.department) query.set('department', params.department);
    if (params?.vendor) query.set('vendor', params.vendor);
    const qs = query.toString();
    return request<{ lines: BudgetLine[] }>(`/budget${qs ? `?${qs}` : ''}`);
  },
  get(id: string) {
    return request<{ line: BudgetLine }>(`/budget/${id}`);
  },
  create(data: Partial<BudgetLine>) {
    return request<{ line: BudgetLine }>('/budget', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<BudgetLine>) {
    return request<{ line: BudgetLine }>(`/budget/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/budget/${id}`, { method: 'DELETE' });
  },
  import(lines: Partial<BudgetLine>[], importFile?: string) {
    return request<{ imported: number; skipped: number; importBatch: string }>('/budget/import', { method: 'POST', body: JSON.stringify({ lines, importFile }) });
  },
  summary(params?: { from?: string; to?: string }) {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return request<{ summary: BudgetSummary[] }>(`/budget/summary${qs ? `?${qs}` : ''}`);
  },
  setDepartment(id: string, department: string) {
    return request<{ ok: boolean; bulkUpdated: number }>(`/budget/${id}/department`, { method: 'PUT', body: JSON.stringify({ department }) });
  },
};

// Calendar
export const calendar = {
  list(params?: { from?: string; to?: string }) {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return request<{ events: CalendarEvent[] }>(`/calendar${qs ? `?${qs}` : ''}`);
  },
  today() {
    return request<{ events: CalendarEvent[] }>('/calendar/today');
  },
  get(id: string) {
    return request<{ event: CalendarEvent }>(`/calendar/${id}`);
  },
  create(data: Partial<CalendarEvent>) {
    return request<{ event: CalendarEvent }>('/calendar', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<CalendarEvent>) {
    return request<{ event: CalendarEvent }>(`/calendar/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/calendar/${id}`, { method: 'DELETE' });
  },
};

// Situations
export const situations = {
  list() {
    return request<{ situations: Situation[] }>('/situations');
  },
  get(id: string) {
    return request<{ situation: Situation; actors: SituationActor[]; notes: SituationNote[]; questions: unknown[]; summaries: SituationSummary[] }>(`/situations/${id}`);
  },
  create(data: { title: string; description?: string }) {
    return request<{ situation: Situation }>('/situations', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<Situation>) {
    return request<{ situation: Situation }>(`/situations/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/situations/${id}`, { method: 'DELETE' });
  },
  addActor(sitId: string, data: { name: string; personId?: string; role?: string; situationRole?: string }) {
    return request<{ actor: SituationActor }>(`/situations/${sitId}/actors`, { method: 'POST', body: JSON.stringify(data) });
  },
  removeActor(sitId: string, actorId: string) {
    return request<{ success: boolean }>(`/situations/${sitId}/actors/${actorId}`, { method: 'DELETE' });
  },
  addNote(sitId: string, data: { content: string; actorId?: string }) {
    return request<{ note: SituationNote }>(`/situations/${sitId}/notes`, { method: 'POST', body: JSON.stringify(data) });
  },
  removeNote(sitId: string, noteId: string) {
    return request<{ success: boolean }>(`/situations/${sitId}/notes/${noteId}`, { method: 'DELETE' });
  },
  addSummary(sitId: string, text: string) {
    return request<{ summary: SituationSummary }>(`/situations/${sitId}/summaries`, { method: 'POST', body: JSON.stringify({ text }) });
  },
};

// User Logs
export const userLogs = {
  list(limit?: number) {
    const query = new URLSearchParams();
    if (limit) query.set('limit', String(limit));
    const qs = query.toString();
    return request<{ logs: UserLog[] }>(`/user-logs${qs ? `?${qs}` : ''}`);
  },
  create(content: string) {
    return request<{ log: UserLog }>('/user-logs', { method: 'POST', body: JSON.stringify({ content }) });
  },
  update(id: string, content: string) {
    return request<{ log: UserLog }>(`/user-logs/${id}`, { method: 'PUT', body: JSON.stringify({ content }) });
  },
  delete(id: string) {
    return request<{ success: boolean }>(`/user-logs/${id}`, { method: 'DELETE' });
  },
  clearAll() {
    return request<{ success: boolean; deleted: number }>('/user-logs', { method: 'DELETE' });
  },
};

// --- MCP Servers ---

export const mcpServersApi = {
  list() {
    return request<MCPServer[]>('/mcp-servers');
  },
  get(id: string) {
    return request<MCPServer>(`/mcp-servers/${id}`);
  },
  create(data: Partial<MCPServer>) {
    return request<MCPServer>('/mcp-servers', { method: 'POST', body: JSON.stringify(data) });
  },
  update(id: string, data: Partial<MCPServer>) {
    return request<MCPServer>(`/mcp-servers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  delete(id: string) {
    return request<{ ok: boolean }>(`/mcp-servers/${id}`, { method: 'DELETE' });
  },
  test(id: string) {
    return request<any>(`/mcp-servers/${id}/test`, { method: 'POST' });
  },
  callTool(id: string, toolName: string, args?: Record<string, any>) {
    return request<any>(`/mcp-servers/${id}/call`, { method: 'POST', body: JSON.stringify({ toolName, args }) });
  },
};

// --- Notion ---

export const notionApi = {
  listIntegrations() {
    return request<NotionIntegration[]>('/notion/integrations');
  },
  createIntegration(data: Partial<NotionIntegration>) {
    return request<NotionIntegration>('/notion/integrations', { method: 'POST', body: JSON.stringify(data) });
  },
  updateIntegration(id: string, data: Partial<NotionIntegration>) {
    return request<NotionIntegration>(`/notion/integrations/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteIntegration(id: string) {
    return request<{ ok: boolean }>(`/notion/integrations/${id}`, { method: 'DELETE' });
  },
  getTickets(integrationId: string) {
    return request<NotionTicket[]>(`/notion/integrations/${integrationId}/tickets`);
  },
  sync(integrationId: string) {
    return request<{ ok: boolean; message: string }>(`/notion/integrations/${integrationId}/sync`, { method: 'POST' });
  },
  cancelSync(integrationId: string) {
    return request<{ ok: boolean }>(`/notion/integrations/${integrationId}/cancel-sync`, { method: 'POST' });
  },
  clearTickets(integrationId: string) {
    return request<{ ok: boolean; deleted: number }>(`/notion/integrations/${integrationId}/tickets`, { method: 'DELETE' });
  },
};

// --- Gmail ---

export const gmailApi = {
  status() {
    return request<GmailStatus>('/gmail/status');
  },
  getAuthUrl() {
    return request<{ url: string; state: string }>('/gmail/auth-url');
  },
  exchangeCode(code: string) {
    return request<{ ok: boolean }>('/gmail/exchange', { method: 'POST', body: JSON.stringify({ code }) });
  },
  disconnect() {
    return request<{ ok: boolean }>('/gmail/disconnect', { method: 'DELETE' });
  },
  listMessages(params?: { label?: string; archived?: boolean; limit?: number; skip?: number }) {
    const qs = params ? new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    ).toString() : '';
    return request<{ messages: GmailMessage[]; total: number }>(`/gmail/messages${qs ? `?${qs}` : ''}`);
  },
  getMessage(messageId: string) {
    return request<GmailMessage>(`/gmail/messages/${messageId}`);
  },
  getThread(threadId: string) {
    return request<GmailMessage[]>(`/gmail/threads/${threadId}`);
  },
  sync(params?: { maxResults?: number; query?: string }) {
    return request<{ ok: boolean; imported: number; total: number }>('/gmail/sync', { method: 'POST', body: JSON.stringify(params || {}) });
  },
  archive(messageId: string) {
    return request<{ ok: boolean }>(`/gmail/messages/${messageId}/archive`, { method: 'POST' });
  },
  trash(messageId: string) {
    return request<{ ok: boolean }>(`/gmail/messages/${messageId}/trash`, { method: 'POST' });
  },
  getLabels() {
    return request<any[]>('/gmail/labels');
  },
  modifyLabels(messageId: string, addLabelIds?: string[], removeLabelIds?: string[]) {
    return request<{ ok: boolean }>(`/gmail/messages/${messageId}/labels`, { method: 'POST', body: JSON.stringify({ addLabelIds, removeLabelIds }) });
  },
  stats() {
    return request<GmailStats>('/gmail/stats');
  },
};

// Claude Code
export const claudeCode = {
  // Projects
  listProjects() {
    return request<{ projects: ClaudeProject[] }>('/claude/projects');
  },
  createProject(data: Partial<ClaudeProject>) {
    return request<{ project: ClaudeProject }>('/claude/projects', { method: 'POST', body: JSON.stringify(data) });
  },
  updateProject(id: string, data: Partial<ClaudeProject>) {
    return request<{ project: ClaudeProject }>(`/claude/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteProject(id: string) {
    return request<{ success: boolean }>(`/claude/projects/${id}`, { method: 'DELETE' });
  },
  // Sessions
  listSessions(projectId: string) {
    return request<{ sessions: ClaudeSession[] }>(`/claude/projects/${projectId}/sessions`);
  },
  createSession(projectId: string, data?: Partial<ClaudeSession>) {
    return request<{ session: ClaudeSession }>(`/claude/projects/${projectId}/sessions`, { method: 'POST', body: JSON.stringify(data || {}) });
  },
  updateSession(id: string, data: Partial<ClaudeSession>) {
    return request<{ session: ClaudeSession }>(`/claude/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteSession(id: string) {
    return request<{ success: boolean }>(`/claude/sessions/${id}`, { method: 'DELETE' });
  },
  // Messages
  listMessages(sessionId: string) {
    return request<{ messages: ClaudeMessage[] }>(`/claude/sessions/${sessionId}/messages`);
  },
  sendMessage(sessionId: string, message: string | unknown[]) {
    return request<{ queued: boolean; message: ClaudeMessage }>(`/claude/sessions/${sessionId}/send`, { method: 'POST', body: JSON.stringify({ message }) });
  },
  stopSession(sessionId: string) {
    return request<{ success: boolean }>(`/claude/sessions/${sessionId}/stop`, { method: 'POST' });
  },
  clearMessages(sessionId: string) {
    return request<{ success: boolean }>(`/claude/sessions/${sessionId}/clear`, { method: 'POST' });
  },
  respondPermission(sessionId: string, behavior: string, updatedInput?: Record<string, unknown>) {
    return request<{ success: boolean }>(`/claude/sessions/${sessionId}/permission`, { method: 'POST', body: JSON.stringify({ behavior, updatedInput }) });
  },
  execShell(sessionId: string, command: string) {
    return request<{ success: boolean }>(`/claude/sessions/${sessionId}/shell`, { method: 'POST', body: JSON.stringify({ command }) });
  },
  markSeen(sessionId: string) {
    return request<{ success: boolean }>(`/claude/sessions/${sessionId}/mark-seen`, { method: 'POST' });
  },
  getHomeDir() {
    return request<{ homeDir: string }>('/claude/home-dir');
  },
};

// Data Import/Export
export const dataTransfer = {
  async importFile(file: File): Promise<{ message: string; stats: any }> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(`${apiBaseUrl}/data/import`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    return res.json();
  },
  async exportData(): Promise<void> {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(`${apiBaseUrl}/data/export`, { headers });

    if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panoramix-export-${new Date().toISOString().slice(0, 10)}.ndjson.gz`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
