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

// Generic binding helper: inject arguments from memory when missing.
// Minimal support: inject ids.projectId for chat_tasksByProject
export const bindArgsWithMemory = (toolName, rawArgs, memory) => {
  const args = { ...(rawArgs || {}) };
  const mem = memory || {};
  if (toolName === 'chat_tasksByProject') {
    const has = args && typeof args.projectId === 'string' && args.projectId.trim();
    if (!has && mem && mem.projectId) {
      args.projectId = mem.projectId;
    }
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


