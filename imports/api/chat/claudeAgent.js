// Claude Agent with streaming and real-time tool call feedback
// Uses @anthropic-ai/sdk with manual tool loop for full control

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey } from '/imports/api/_shared/config';
import { TOOL_HANDLERS } from '/imports/api/tools/handlers';
import { TOOL_DEFINITIONS } from '/imports/api/tools/definitions';
import { buildUserContextBlock } from '/imports/api/_shared/userContext';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 4096;
const MAX_ITERATIONS = 30;
const MAX_HISTORY_MESSAGES = 40; // Limit history to control token usage

// Cache tool definitions at module level (they don't change at runtime)
let cachedTools = null;

/**
 * Build and cache tool definitions for Claude
 */
function getToolDefinitions() {
  if (cachedTools) return cachedTools;

  cachedTools = TOOL_DEFINITIONS
    .map((toolDef) => {
      const handler = TOOL_HANDLERS[toolDef.name];
      if (!handler) {
        console.warn(`[claudeAgent] No handler found for tool: ${toolDef.name}`);
        return null;
      }

      return {
        name: toolDef.name,
        description: toolDef.description || '',
        input_schema: {
          type: 'object',
          properties: toolDef.parameters?.properties || {},
          required: toolDef.parameters?.required || []
        }
      };
    })
    .filter(Boolean);

  return cachedTools;
}

/**
 * Build system prompt for Claude agent
 */
function buildSystemPrompt() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const userContext = buildUserContextBlock();

  return [
    "Tu es l'assistant de Panorama, une application de gestion de projets, tâches et notes.",
    "",
    userContext,
    `CONTEXTE TEMPOREL: Nous sommes le ${now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (${tz}).`,
    "",
    "Tu as accès à des outils pour interroger et modifier les données de l'utilisateur.",
    "Utilise les outils quand tu as besoin de récupérer ou mettre à jour des données.",
    "Sois concis dans tes réponses. Ne fabrique pas d'informations.",
    "Quand tu présentes des données, montre les champs lisibles (titres, noms, dates) pas les IDs internes.",
    "Réponds en français sauf si l'utilisateur parle une autre langue.",
    "",
    "RÈGLE CRITIQUE SUR LES DONNÉES:",
    "- Tu dois utiliser EXCLUSIVEMENT les données retournées par les outils.",
    "- INTERDIT d'utiliser tes connaissances pré-existantes sur les personnes, entreprises, ou projets.",
    "- INTERDIT d'inventer, deviner, ou compléter des informations manquantes.",
    "- Si une information n'est pas dans le tool result, dis explicitement que tu ne l'as pas.",
    "",
    "PARALLÉLISATION:",
    "Quand tu dois effectuer plusieurs opérations similaires (ex: mettre à jour 5 tâches), appelle TOUS les outils en parallèle dans une seule réponse.",
    "NE FAIS PAS d'appels séquentiels pour des opérations indépendantes. Exemple: pour modifier 8 tâches, appelle tool_updateTask 8 fois EN MÊME TEMPS.",
    "",
    "RÈGLES CRITIQUES SUR LES IDs:",
    "- Tu ne connais AUCUN ID de projet, tâche ou note. Les IDs sont des chaînes de 17 caractères alphanumériques (ex: \"5iWBrGAPSjbtEXgbL\").",
    "- INTERDIT d'inventer ou deviner un ID. Si tu utilises un ID qui n'existe pas, tu recevras une erreur.",
    "- TOUJOURS utiliser tool_projectByName({\"name\": \"...\"}) pour obtenir l'ID d'un projet AVANT d'appeler tool_tasksByProject ou tool_notesByProject.",
    "- Ne JAMAIS réutiliser un ID d'une conversation précédente sans le re-vérifier via tool_projectByName.",
    "",
    "NAVIGATION:",
    "Quand l'utilisateur demande d'OUVRIR, ALLER vers, ou AFFICHER un projet/note/session:",
    "1. Utilise d'abord tool_projectByName (ou tool_notesByProject, etc.) pour trouver l'élément.",
    "2. Si UN SEUL résultat correspond, inclus une action de navigation à la FIN de ta réponse:",
    "```navigation",
    '{"action":"navigate","kind":"project","id":"<projectId>"}',
    "```",
    "3. Si PLUSIEURS résultats correspondent, propose-les comme choix SANS action de navigation.",
    "4. Kinds supportés: project, session, note, alarms, emails, preferences"
  ].join('\n');
}

/**
 * Build messages array for Claude from query and history
 * Limits history to MAX_HISTORY_MESSAGES to control token usage
 */
function buildMessages(query, history = []) {
  const messages = [];

  // Filter and limit history
  const validHistory = history
    .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && !msg.isStatus)
    .slice(-MAX_HISTORY_MESSAGES);

  for (const msg of validHistory) {
    messages.push({
      role: msg.role,
      content: msg.content || ''
    });
  }

  messages.push({
    role: 'user',
    content: query
  });

  return messages;
}

/**
 * Execute a tool by name with given arguments
 */
async function executeTool(toolName, args) {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  try {
    const result = await handler(args, null); // No memory needed with agentic approach
    // Handlers return {output: string} structure
    const output = result?.output || JSON.stringify(result);

    // DEBUG: Log tool execution for tool_peopleList
    if (toolName === 'tool_peopleList') {
      console.log(`[claudeAgent] ${toolName} executed, output size:`, output.length, 'chars');
      console.log(`[claudeAgent] ${toolName} output preview:`, output.substring(0, 500) + '...');
    }

    return output;
  } catch (error) {
    console.error(`[claudeAgent] Tool ${toolName} error:`, error);
    return JSON.stringify({
      error: {
        code: 'TOOL_ERROR',
        message: error?.message || String(error),
        tool: toolName
      }
    });
  }
}

/**
 * Execute multiple tools in parallel
 */
async function executeToolsInParallel(toolUseBlocks) {
  const results = await Promise.all(
    toolUseBlocks.map(async (toolUse) => {
      const result = await executeTool(toolUse.name, toolUse.input);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result
      };
    })
  );
  return results;
}

/**
 * Extract navigation actions from agent text response
 * Looks for ```navigation code blocks with JSON action objects
 */
function extractActions(text) {
  const actions = [];
  if (!text) return actions;

  // Match ```navigation ... ``` blocks
  const regex = /```navigation\s*\n?([\s\S]*?)\n?```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    try {
      const actionData = JSON.parse(match[1].trim());
      if (actionData.action && actionData.kind && actionData.id) {
        actions.push({
          type: actionData.action,
          kind: actionData.kind,
          id: actionData.id,
          title: actionData.title || null
        });
      }
    } catch (e) {
      console.warn('[claudeAgent] Failed to parse navigation action:', e.message);
    }
  }

  return actions;
}

/**
 * Remove navigation blocks from text for cleaner display
 */
function cleanNavigationBlocks(text) {
  if (!text) return '';
  return text.replace(/```navigation\s*\n?[\s\S]*?\n?```/g, '').trim();
}

/**
 * Extract citations from tool results in the conversation
 */
function extractCitations(messages) {
  const citations = [];

  for (const msg of messages) {
    if (msg.role !== 'user') continue;

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type !== 'tool_result') continue;

      try {
        const parsed = JSON.parse(block.content || '{}');
        const results = parsed?.data?.results || parsed?.results || [];
        if (Array.isArray(results)) {
          for (const item of results) {
            if (item.id && item.title) {
              citations.push({
                id: item.id,
                title: item.title,
                kind: item.kind || 'unknown',
                url: item.url || null
              });
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return citations;
}

/**
 * Format tool name for display (remove tool_ prefix, add spaces)
 */
function formatToolName(toolName) {
  return toolName
    .replace(/^tool_/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format tool arguments for display (show key params only)
 */
function formatToolArgs(toolName, args) {
  if (!args || Object.keys(args).length === 0) return '';

  // Show only the most relevant argument for each tool type
  const keyArgs = [];

  if (args.query) keyArgs.push(`"${args.query}"`);
  else if (args.name) keyArgs.push(`"${args.name}"`);
  else if (args.title) keyArgs.push(`"${args.title}"`);
  else if (args.projectId) keyArgs.push(`projet`);
  else if (args.taskId) keyArgs.push(`tâche`);
  else if (args.noteId) keyArgs.push(`note`);

  return keyArgs.length > 0 ? ` (${keyArgs.join(', ')})` : '';
}

/**
 * Run the Claude agent with streaming and real-time feedback
 *
 * @param {string} query - User's question
 * @param {Array} history - Previous chat messages
 * @param {object} options - Optional configuration
 * @param {Function} options.onToolStart - Called when tool execution starts
 * @param {Function} options.onToolEnd - Called when tool execution ends
 * @param {Function} options.onText - Called with text chunks during streaming
 * @returns {Promise<{text: string, citations: Array}>}
 */
export async function runChatAgent(query, history = [], options = {}) {
  const apiKey = getAnthropicApiKey();

  if (!apiKey) {
    throw new Error('Clé API Anthropic non configurée. Ajoutez-la dans les Préférences.');
  }

  const client = new Anthropic({ apiKey });
  const tools = getToolDefinitions();
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const system = buildSystemPrompt();
  const messages = buildMessages(query, history);

  const { onToolStart, onToolEnd, onText } = options;

  console.log(`[claudeAgent] Starting agent - model: ${model}, tools: ${tools.length}, history: ${messages.length - 1} msgs`);

  const conversationHistory = [...messages];
  let totalToolCalls = 0;
  let finalText = '';
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Use streaming for real-time feedback
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools
    });

    const textChunks = [];
    const toolUseBlocks = [];
    let currentToolUse = null;

    // Process stream events
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'text') {
          // Text block starting
        } else if (event.content_block?.type === 'tool_use') {
          // Tool use block starting
          currentToolUse = {
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: {}
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          textChunks.push(event.delta.text);
          // Stream text to callback
          if (onText) {
            try {
              await onText(event.delta.text);
            } catch (e) {
              console.error('[claudeAgent] onText callback error:', e);
            }
          }
        } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
          // Accumulate tool input JSON
          if (!currentToolUse._inputJson) currentToolUse._inputJson = '';
          currentToolUse._inputJson += event.delta.partial_json || '';
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          // Parse accumulated JSON input
          if (currentToolUse._inputJson) {
            try {
              currentToolUse.input = JSON.parse(currentToolUse._inputJson);
            } catch (e) {
              console.error('[claudeAgent] Failed to parse tool input:', e);
              currentToolUse.input = {};
            }
            delete currentToolUse._inputJson;
          }
          toolUseBlocks.push(currentToolUse);
          currentToolUse = null;
        }
      }
    }

    // Get final response for stop_reason
    const response = await stream.finalMessage();
    const stopReason = response.stop_reason;
    const iterationText = textChunks.join('');

    // If no tool calls, we're done
    if (stopReason === 'end_turn' || toolUseBlocks.length === 0) {
      finalText = iterationText;
      const citations = extractCitations(conversationHistory);
      const actions = extractActions(finalText);
      const cleanText = cleanNavigationBlocks(finalText);
      console.log(`[claudeAgent] Agent completed. Total tool calls: ${totalToolCalls}, actions: ${actions.length}`);
      return { text: cleanText, citations, actions };
    }

    // Execute tool calls in parallel
    totalToolCalls += toolUseBlocks.length;
    console.log(`[claudeAgent] Iteration ${iteration + 1}: ${toolUseBlocks.length} tool call(s) in parallel`);

    // Notify about tool execution start
    const toolNames = toolUseBlocks.map(t => ({
      name: t.name,
      displayName: formatToolName(t.name),
      args: formatToolArgs(t.name, t.input)
    }));

    if (onToolStart) {
      try {
        await onToolStart(toolNames);
      } catch (e) {
        console.error('[claudeAgent] onToolStart callback error:', e);
      }
    }

    // Execute all tools in parallel
    const toolResults = await executeToolsInParallel(toolUseBlocks);

    // DEBUG: Log tool results being sent to Claude
    if (toolUseBlocks.some(t => t.name === 'tool_peopleList')) {
      const peopleResult = toolResults.find(r =>
        toolUseBlocks.find(b => b.id === r.tool_use_id && b.name === 'tool_peopleList')
      );
      if (peopleResult) {
        console.log('[claudeAgent] Sending tool_peopleList result to Claude:', peopleResult.content.substring(0, 500) + '...');
      }
    }

    // Notify about tool execution end
    if (onToolEnd) {
      try {
        await onToolEnd(toolNames, toolResults);
      } catch (e) {
        console.error('[claudeAgent] onToolEnd callback error:', e);
      }
    }

    // Add assistant message with tool calls to conversation
    messages.push({
      role: 'assistant',
      content: response.content
    });

    // Add tool results as user message
    const toolResultMessage = {
      role: 'user',
      content: toolResults
    };
    messages.push(toolResultMessage);
    conversationHistory.push(toolResultMessage);
  }

  // Safety: max iterations reached
  console.warn('[claudeAgent] Max iterations reached');
  return {
    text: "J'ai atteint la limite d'itérations. Peux-tu reformuler ta question ?",
    citations: [],
    actions: []
  };
}

/**
 * Check if Claude agent is available (API key configured)
 */
export function isClaudeAgentAvailable() {
  return !!getAnthropicApiKey();
}
