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


