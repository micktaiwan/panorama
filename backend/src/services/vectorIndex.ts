import { upsertDoc, deleteDoc, deleteByDocId, deleteByProjectId } from './vectorStore.js';
import { getQdrantUrl } from './config.js';

/**
 * Fire-and-forget vector indexing helpers.
 * Called after CRUD operations — failures are logged but never block the API response.
 */

function isQdrantConfigured(): boolean {
  return !!getQdrantUrl();
}

function logError(action: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.warn(`[vectorIndex] ${action} failed: ${msg}`);
}

// Build searchable text from a document
function projectText(doc: { name?: string; description?: string }): string {
  return [doc.name, doc.description].filter(Boolean).join('\n');
}

function taskText(doc: { title?: string; description?: string }): string {
  return [doc.title, doc.description].filter(Boolean).join('\n');
}

function noteText(doc: { title?: string; content?: string }): string {
  return [doc.title, doc.content].filter(Boolean).join('\n');
}

// --- Project indexing ---

export function indexProject(project: { _id: unknown; userId?: unknown; name?: string; description?: string }) {
  if (!isQdrantConfigured()) return;
  const text = projectText(project);
  if (!text.trim()) return;

  upsertDoc({
    kind: 'project',
    id: String(project._id),
    text,
    extraPayload: { name: project.name },
  }).catch(err => logError(`index project ${project._id}`, err));
}

export function removeProject(projectId: string) {
  if (!isQdrantConfigured()) return;
  deleteDoc('project', projectId).catch(err => logError(`delete project ${projectId}`, err));
}

export function removeProjectCascade(projectId: string) {
  if (!isQdrantConfigured()) return;
  deleteByProjectId(projectId).catch(err => logError(`cascade delete project ${projectId}`, err));
}

// --- Task indexing ---

export function indexTask(task: { _id: unknown; projectId?: unknown; userId?: unknown; title?: string; description?: string }) {
  if (!isQdrantConfigured()) return;
  const text = taskText(task);
  if (!text.trim()) return;

  upsertDoc({
    kind: 'task',
    id: String(task._id),
    text,
    projectId: task.projectId ? String(task.projectId) : null,
    extraPayload: { title: task.title },
  }).catch(err => logError(`index task ${task._id}`, err));
}

export function removeTask(taskId: string) {
  if (!isQdrantConfigured()) return;
  deleteDoc('task', taskId).catch(err => logError(`delete task ${taskId}`, err));
}

// --- Note indexing ---

export function indexNote(note: { _id: unknown; projectId?: unknown; userId?: unknown; title?: string; content?: string }) {
  if (!isQdrantConfigured()) return;
  const text = noteText(note);
  if (!text.trim()) return;

  upsertDoc({
    kind: 'note',
    id: String(note._id),
    text,
    projectId: note.projectId ? String(note.projectId) : null,
    extraPayload: { title: note.title },
  }).catch(err => logError(`index note ${note._id}`, err));
}

export function removeNote(noteId: string) {
  if (!isQdrantConfigured()) return;
  deleteDoc('note', noteId).catch(err => logError(`delete note ${noteId}`, err));
}

// --- Link indexing ---

export function indexLink(link: { _id: unknown; projectId?: unknown; userId?: unknown; name?: string; url?: string }) {
  if (!isQdrantConfigured()) return;
  const text = [link.name, link.url].filter(Boolean).join('\n');
  if (!text.trim()) return;

  upsertDoc({
    kind: 'link',
    id: String(link._id),
    text,
    projectId: link.projectId ? String(link.projectId) : null,
    extraPayload: { name: link.name, url: link.url },
  }).catch(err => logError(`index link ${link._id}`, err));
}

export function removeLink(linkId: string) {
  if (!isQdrantConfigured()) return;
  deleteDoc('link', linkId).catch(err => logError(`delete link ${linkId}`, err));
}
