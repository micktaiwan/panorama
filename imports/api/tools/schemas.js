// Tool schemas with required arguments and metadata
// Used for validation and tool call execution

export const TOOL_SCHEMAS = {
  tool_listTools: { required: [], readOnly: true },
  tool_tasksByProject: { required: ['projectId'], readOnly: true },
  tool_tasksFilter: { required: [], readOnly: true },
  tool_projectsList: { required: [], readOnly: true },
  tool_projectByName: { required: ['name'], readOnly: true },
  tool_semanticSearch: { required: ['query'], readOnly: true },
  tool_collectionQuery: { required: ['collection'], readOnly: true },
  tool_notesByProject: { required: ['projectId'], readOnly: true },
  tool_noteById: { required: ['noteId'], readOnly: true },
  tool_noteSessionsByProject: { required: ['projectId'], readOnly: true },
  tool_noteLinesBySession: { required: ['sessionId'], readOnly: true },
  tool_linksByProject: { required: ['projectId'], readOnly: true },
  tool_peopleList: { required: [], readOnly: true },
  tool_teamsList: { required: [], readOnly: true },
  tool_filesByProject: { required: ['projectId'], readOnly: true },
  tool_alarmsList: { required: [], readOnly: true },
  tool_createTask: { required: ['title'], readOnly: false },
  tool_updateTask: { required: ['taskId'], readOnly: false },
  tool_createNote: { required: ['title'], readOnly: false },
  tool_updateNote: { required: ['noteId'], readOnly: false },
  tool_userLogsFilter: { required: [], readOnly: true }
};
