// Single source of truth for task statuses.
// Workflow: todo -> in_progress -> testing -> done (cancelled / idea are side exits).
// Imported by the UI (select options, row styling), the server methods and the
// MCP tool definitions so an enum can never drift between them.

export const TASK_STATUSES = ['todo', 'in_progress', 'testing', 'done', 'cancelled', 'idea'];

// Statuses that keep a task in the active lists.
export const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'testing'];

// Statuses that take a task out of the active lists.
export const CLOSED_TASK_STATUSES = ['done', 'cancelled', 'idea'];

export const TASK_STATUS_LABELS = {
  todo: 'to do',
  in_progress: 'in progress',
  testing: 'testing',
  done: 'done',
  cancelled: 'cancelled',
  idea: 'idea'
};

// Options for <select> inputs, in workflow order.
export const TASK_STATUS_OPTIONS = TASK_STATUSES.map(value => ({ value, label: TASK_STATUS_LABELS[value] }));

// Sort weight used everywhere open tasks are ordered: work in flight first,
// then what is waiting for validation, then the rest.
export const taskStatusRank = (status) => {
  if (status === 'in_progress') return 0;
  if (status === 'testing') return 1;
  return 2;
};

// True when the status keeps the task in the active lists.
export const isOpenTaskStatus = (status) => !CLOSED_TASK_STATUSES.includes(status || 'todo');
