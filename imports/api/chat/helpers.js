// Pure helpers for chat tools. No Meteor imports here.

export const buildTasksSelector = (search = {}) => {
  const selector = {};
  if (search && typeof search.projectId === 'string' && search.projectId.trim()) selector.projectId = search.projectId.trim();
  if (search && typeof search.status === 'string' && search.status.trim()) selector.status = search.status.trim();
  if (search && typeof search.dueBefore === 'string' && search.dueBefore.trim()) {
    const dt = new Date(search.dueBefore);
    if (!Number.isNaN(dt.getTime())) {
      // Match either a Date field or a string YYYY-MM-DD field
      const ymd = dt.toISOString().slice(0, 10);
      selector.$or = [
        { deadline: { $lte: dt } },
        { deadline: { $lte: ymd } }
      ];
    }
  }
  return selector;
};

export const mapToolCallsForChatCompletions = (toolCalls, toolResults) => {
  const shortenId = (id) => {
    const s = String(id || 'call_0');
    return s.length > 40 ? s.slice(0, 40) : s;
  };
  const mappedCalls = (toolCalls || []).map(tc => ({
    origId: tc.id || 'call_0',
    id: shortenId(tc.id || 'call_0'),
    name: tc.name,
    args: JSON.stringify(tc.arguments || {})
  }));
  const idMap = new Map(mappedCalls.map(c => [c.origId, c.id]));
  const assistantToolCallMsg = {
    role: 'assistant',
    tool_calls: mappedCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }))
  };
  const toolMsgs = (toolResults || []).map(tr => ({ role: 'tool', tool_call_id: idMap.get(tr.tool_call_id) || mappedCalls[0]?.id || 'call_0', content: tr.output || '{}' }));
  return { assistantToolCallMsg, toolMsgs };
};

// Additional tool helper builders (pure)
export const buildOverdueSelector = (nowIso) => {
  const d = new Date(nowIso || new Date().toISOString());
  if (Number.isNaN(d.getTime())) return { status: { $ne: 'done' } };
  const ymd = d.toISOString().slice(0, 10);
  return { status: { $ne: 'done' }, $or: [ { deadline: { $lte: d } }, { deadline: { $lte: ymd } } ] };
};

export const buildByProjectSelector = (projectId) => {
  const id = String(projectId || '').trim();
  const sel = id ? { projectId: id } : {};
  return { ...sel, status: { $ne: 'done' } };
};

export const buildFilterSelector = (filters = {}) => {
  const sel = {};
  if (filters.projectId) sel.projectId = String(filters.projectId).trim();
  if (filters.status) sel.status = String(filters.status).trim();
  if (filters.tag) sel.tags = String(filters.tag).trim();
  if (typeof filters.important !== 'undefined') {
    const v = (typeof filters.important === 'string') ? filters.important.trim().toLowerCase() : filters.important;
    if (v === true || v === 'true' || v === '1') sel.isImportant = true;
    if (v === false || v === 'false' || v === '0') sel.isImportant = false;
  }
  if (typeof filters.urgent !== 'undefined') {
    const v = (typeof filters.urgent === 'string') ? filters.urgent.trim().toLowerCase() : filters.urgent;
    if (v === true || v === 'true' || v === '1') sel.isUrgent = true;
    if (v === false || v === 'false' || v === '0') sel.isUrgent = false;
  }
  return sel;
};


// Build a selector to find a project by name (case-insensitive; trims input).
// Uses a case-insensitive regex. For accent-insensitive needs, consider storing a normalizedName field.
export const buildProjectByNameSelector = (rawName) => {
  const name = String(rawName || '').trim();
  if (!name) return {};
  try {
    // Escape regex special chars in user-provided name
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { name: { $regex: `^${escaped}$`, $options: 'i' } };
  } catch (_e) {
    return { name };
  }
};

// Generic path resolver for {var:'path'} syntax
const resolveVariable = (value, memory) => {
  if (typeof value === 'object' && value !== null && value.var) {
    const path = String(value.var).split('.');
    let current = memory;
    for (const segment of path) {
      if (!current || typeof current !== 'object') return undefined;
      current = current[segment];
    }
    return current;
  }
  return value;
};

// Generic binding helper: inject arguments from memory when missing
// Supports {var:'ids.projectId'} syntax and legacy memory.projectId fallback
export const bindArgsWithMemory = (toolName, rawArgs, memory) => {
  const args = { ...(rawArgs || {}) };
  const mem = memory || {};
  
  // Process all args for variable resolution
  Object.keys(args).forEach(key => {
    args[key] = resolveVariable(args[key], mem);
  });
  
  // Generic fallbacks for common missing arguments
  if (toolName === 'chat_tasksByProject' && !args.projectId) {
    args.projectId = mem.ids?.projectId || mem.projectId;
  }
  if (toolName === 'chat_notesByProject' && !args.projectId) {
    args.projectId = mem.ids?.projectId || mem.projectId;
  }
  if (toolName === 'chat_noteSessionsByProject' && !args.projectId) {
    args.projectId = mem.ids?.projectId || mem.projectId;
  }
  if (toolName === 'chat_noteLinesBySession' && !args.sessionId) {
    args.sessionId = mem.ids?.sessionId || mem.sessionId;
  }
  if (toolName === 'chat_linksByProject' && !args.projectId) {
    args.projectId = mem.ids?.projectId || mem.projectId;
  }
  if (toolName === 'chat_filesByProject' && !args.projectId) {
    args.projectId = mem.ids?.projectId || mem.projectId;
  }
  
  return args;
};

// Cap tool-calls list to a maximum length (default 5)
export const capToolCalls = (toolCalls, max = 5) => {
  const arr = Array.isArray(toolCalls) ? toolCalls : [];
  const m = Number(max);
  const limit = Number.isFinite(m) && m > 0 ? m : 5;
  return arr.slice(0, limit);
};

// Evaluate artifact-based stop conditions with dot-path and basic wildcards
export const evaluateStopWhen = (have, memory) => {
  if (!Array.isArray(have) || have.length === 0) return false;
  const mem = memory || {};
  const getPath = (obj, path) => {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i += 1) {
      const k = parts[i];
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[k];
    }
    return cur;
  };
  const checkOne = (expr) => {
    const key = String(expr || '').trim();
    if (!key) return false;
    if (key === 'lists.*') {
      const lists = mem.lists || {};
      return Object.values(lists).some((v) => Array.isArray(v) && v.length > 0);
    }
    if (key.startsWith('lists.')) {
      const arr = getPath(mem, key);
      return Array.isArray(arr) && arr.length > 0;
    }
    if (key === 'entities.*') {
      const ents = mem.entities || {};
      return Object.values(ents).some((v) => !!v);
    }
    if (key.startsWith('entities.')) {
      return !!getPath(mem, key);
    }
    if (key === 'ids.*') {
      const ids = mem.ids || {};
      return Object.values(ids).some((v) => !!v);
    }
    if (key.startsWith('ids.')) {
      return !!getPath(mem, key);
    }
    return !!getPath(mem, key);
  };
  return have.every(checkOne);
};

// Generic registry: allowed fields per collection for read-only queries
export const FIELD_ALLOWLIST = {
  tasks: ['title', 'status', 'deadline', 'projectId', 'isUrgent', 'isImportant', 'tags', 'createdAt', 'updatedAt'],
  projects: ['name', 'description', 'createdAt', 'updatedAt'],
  notes: ['projectId', 'title', 'content', 'createdAt', 'updatedAt'],
  noteSessions: ['projectId', 'name', 'createdAt', 'updatedAt'],
  noteLines: ['sessionId', 'content', 'createdAt', 'updatedAt'],
  links: ['projectId', 'name', 'url', 'createdAt', 'updatedAt'],
  people: ['name', 'createdAt', 'updatedAt'],
  teams: ['name', 'createdAt', 'updatedAt'],
  files: ['projectId', 'name', 'createdAt', 'updatedAt'],
  alarms: ['title', 'enabled', 'when', 'createdAt', 'updatedAt']
};

// Map collection name to lists.* memory key
export const getListKeyForCollection = (collection) => {
  const c = String(collection || '').trim();
  const map = {
    tasks: 'tasks',
    projects: 'projects',
    notes: 'notes',
    noteSessions: 'noteSessions',
    noteLines: 'noteLines',
    links: 'links',
    people: 'people',
    teams: 'teams',
    files: 'files',
    alarms: 'alarms'
  };
  return map[c] || c;
};

// Compile a safe where object (mini-DSL) into a Mongo selector using allowlist
// Supported ops: eq, ne, lt, lte, gt, gte, in, nin, and/or (arrays)
export const compileWhere = (collection, where = {}) => {
  const allowed = FIELD_ALLOWLIST[String(collection)];
  const isAllowedField = (f) => Array.isArray(allowed) && allowed.includes(String(f));
  const compileNode = (node) => {
    if (!node || typeof node !== 'object') return {};
    const sel = {};
    // Logical operators
    if (Array.isArray(node.and)) {
      sel.$and = node.and.map(compileNode).filter(Boolean);
    }
    if (Array.isArray(node.or)) {
      sel.$or = node.or.map(compileNode).filter(Boolean);
    }
    // Field comparisons
    Object.keys(node).forEach((k) => {
      if (k === 'and' || k === 'or') return;
      if (!isAllowedField(k)) return;
      const v = node[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ops = {};
        if (Object.prototype.hasOwnProperty.call(v, 'eq')) ops.$eq = v.eq;
        if (Object.prototype.hasOwnProperty.call(v, 'ne')) ops.$ne = v.ne;
        if (Object.prototype.hasOwnProperty.call(v, 'lt')) ops.$lt = v.lt;
        if (Object.prototype.hasOwnProperty.call(v, 'lte')) ops.$lte = v.lte;
        if (Object.prototype.hasOwnProperty.call(v, 'gt')) ops.$gt = v.gt;
        if (Object.prototype.hasOwnProperty.call(v, 'gte')) ops.$gte = v.gte;
        if (Object.prototype.hasOwnProperty.call(v, 'in')) ops.$in = Array.isArray(v.in) ? v.in : [v.in];
        if (Object.prototype.hasOwnProperty.call(v, 'nin')) ops.$nin = Array.isArray(v.nin) ? v.nin : [v.nin];
        if (Object.keys(ops).length > 0) sel[k] = ops;
      } else {
        sel[k] = v;
      }
    });
    return sel;
  };
  return compileNode(where);
};


