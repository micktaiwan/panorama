import { Meteor } from 'meteor/meteor';
import { spawn, exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ClaudeSessionsCollection } from './collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';

// Resolve claude binary path at startup (Meteor's PATH may not include homebrew/nvm dirs)
let claudeBin = 'claude';
try {
  claudeBin = execSync('which claude', { encoding: 'utf8' }).trim();
} catch (_) {
  console.warn('[claude-pm] "claude" not found in PATH, spawn will likely fail');
}

// Resolve codex binary path at startup
let codexBin = 'codex';
try {
  codexBin = execSync('which codex', { encoding: 'utf8' }).trim();
} catch (_) {
  console.warn('[claude-pm] "codex" not found in PATH');
}

// --- File logger (with rotation) ---
const LOG_FILE = path.join(process.env.HOME || '/tmp', '.panorama-claude.log');
const LOG_MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// Rotate on startup: keep only the last half when file exceeds max size
try {
  const stat = fs.statSync(LOG_FILE);
  if (stat.size > LOG_MAX_SIZE) {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const half = content.slice(content.length / 2);
    const firstNewline = half.indexOf('\n');
    fs.writeFileSync(LOG_FILE, firstNewline >= 0 ? half.slice(firstNewline + 1) : half);
    console.log(`[claude-pm] Log rotated: ${(stat.size / 1024 / 1024).toFixed(1)}MB → ${(fs.statSync(LOG_FILE).size / 1024 / 1024).toFixed(1)}MB`);
  }
} catch { /* log rotation is best-effort */ }

function log(...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [claude-pm] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  console.log('[claude-pm]', ...args);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function logError(...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [claude-pm] ERROR ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  console.error('[claude-pm]', ...args);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// In-memory map: sessionId -> ChildProcess
const activeProcesses = new Map();

// In-memory map: sessionId -> { requestId, toolName, toolInput }
const pendingPermissions = new Map();

// In-memory message queue: sessionId -> [{ msgId, content }, ...]
const messageQueues = new Map();

// In-memory debate state: sessionId -> { aborted, currentProc }
const activeDebates = new Map();

export function queueMessage(sessionId, message, msgId) {
  if (!messageQueues.has(sessionId)) messageQueues.set(sessionId, []);
  messageQueues.get(sessionId).push({ msgId, content: message });
  log('queued message for', sessionId, '| msgId:', msgId, '| queue size:', messageQueues.get(sessionId).length);
  syncQueueCount(sessionId);
}

export async function clearQueue(sessionId) {
  const q = messageQueues.get(sessionId);
  if (q?.length) {
    log('clearing queue for', sessionId, '| discarding', q.length, 'messages');
    // Mark all queued messages as no longer queued in DB
    for (const entry of q) {
      if (entry.msgId) {
        await ClaudeMessagesCollection.updateAsync(entry.msgId, { $unset: { queued: 1 } });
      }
    }
  }
  messageQueues.delete(sessionId);
  syncQueueCount(sessionId);
}

export async function dequeueMessage(sessionId, msgId) {
  const q = messageQueues.get(sessionId);
  if (!q) return false;
  const idx = q.findIndex(entry => entry.msgId === msgId);
  if (idx === -1) return false;
  q.splice(idx, 1);
  const remaining = q.length;
  if (remaining === 0) messageQueues.delete(sessionId);
  log('dequeued message', msgId, 'for', sessionId, '| remaining:', remaining);
  syncQueueCount(sessionId);
  return true;
}

function hasQueuedMessages(sessionId) {
  return messageQueues.get(sessionId)?.length > 0;
}

function syncQueueCount(sessionId) {
  const count = messageQueues.get(sessionId)?.length || 0;
  ClaudeSessionsCollection.updateAsync(sessionId, {
    $set: { queuedCount: count, updatedAt: new Date() }
  }).catch(err => logError('syncQueueCount failed:', err.message));
}

async function drainQueue(sessionId) {
  const q = messageQueues.get(sessionId);
  if (!q?.length) return;
  const entry = q.shift();
  if (q.length === 0) messageQueues.delete(sessionId);
  log('drainQueue for', sessionId, '| processing next message, remaining:', q?.length || 0);
  syncQueueCount(sessionId);
  // Mark the message as no longer queued and update createdAt so it appears at the right position in the flow
  if (entry.msgId) {
    await ClaudeMessagesCollection.updateAsync(entry.msgId, { $unset: { queued: 1 }, $set: { createdAt: new Date() } });
  }
  const session = await ClaudeSessionsCollection.findOneAsync(sessionId);
  if (session) {
    spawnClaudeProcess(session, entry.content);
  }
}

export function isRunning(sessionId) {
  return activeProcesses.has(sessionId);
}

export async function killProcess(sessionId) {
  await clearQueue(sessionId);
  pendingPermissions.delete(sessionId);
  const proc = activeProcesses.get(sessionId);
  if (!proc) {
    log('killProcess: no process for', sessionId);
    return;
  }

  log('killing process for', sessionId);
  activeProcesses.delete(sessionId);

  // Wait for process to actually exit before returning
  await new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      log('killProcess: SIGTERM timeout, sending SIGKILL for', sessionId);
      try { proc.kill('SIGKILL'); } catch { /* process may already be dead */ }
      // Give SIGKILL a moment to work, then resolve anyway
      setTimeout(resolve, 500);
    }, 5000);

    proc.once('exit', () => {
      clearTimeout(forceKillTimer);
      log('killProcess: process exited for', sessionId);
      resolve();
    });

    proc.kill('SIGTERM');
  });

  await ClaudeSessionsCollection.updateAsync(sessionId, {
    $set: { status: 'idle', pid: null, updatedAt: new Date() }
  });

  // Drain any messages that were queued during the kill (race condition:
  // sendMessage can queue a message after clearQueue but before status is idle)
  drainQueue(sessionId);
}

// Determine if a permission mode auto-allows a given tool
function shouldAutoAllow(permissionMode, toolName) {
  if (permissionMode === 'bypassPermissions') return true;
  if (permissionMode === 'acceptEdits') {
    const editTools = ['Edit', 'Write', 'Read', 'NotebookEdit', 'MultiEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
    return editTools.includes(toolName);
  }
  return false;
}

// Auto-respond to a pending permission when the user changes permission mode
export async function syncPermissionMode(sessionId, newMode) {
  const pending = pendingPermissions.get(sessionId);
  if (!pending) return;

  const proc = activeProcesses.get(sessionId);
  if (!proc) return;

  if (!shouldAutoAllow(newMode, pending.toolName)) return;

  log('syncPermissionMode: auto-allowing pending', pending.toolName, 'per new mode:', newMode);

  const response = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: pending.requestId,
      response: {
        behavior: 'allow',
        updatedInput: pending.toolInput,
        updatedPermissions: [{ type: 'setMode', mode: newMode, destination: 'session' }],
      },
    },
  };

  proc.stdin.write(JSON.stringify(response) + '\n');
  pendingPermissions.delete(sessionId);

  // Mark the permission_request message as auto-responded
  await ClaudeMessagesCollection.updateAsync(
    { sessionId, type: 'permission_request', toolName: pending.toolName, autoResponded: { $ne: true } },
    { $set: { autoResponded: true, autoRespondedMode: newMode } },
  );
}

export function respondToPermission(sessionId, behavior, updatedToolInput) {
  const pending = pendingPermissions.get(sessionId);
  if (!pending) {
    log('respondToPermission: no pending request for', sessionId);
    return;
  }

  const proc = activeProcesses.get(sessionId);
  if (!proc) {
    log('respondToPermission: no active process for', sessionId);
    pendingPermissions.delete(sessionId);
    return;
  }

  const toolInput = updatedToolInput || pending.toolInput || {};

  const permissionResponse = behavior === 'deny'
    ? { behavior: 'deny', message: 'User denied' }
    : behavior === 'allowAll'
      ? { behavior: 'allow', updatedInput: toolInput, updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }
      : { behavior: 'allow', updatedInput: toolInput };

  const response = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: pending.requestId,
      response: permissionResponse,
    },
  };

  log('respondToPermission:', sessionId, 'behavior:', behavior, 'requestId:', pending.requestId);
  proc.stdin.write(JSON.stringify(response) + '\n');
  pendingPermissions.delete(sessionId);

  // Sync permission mode to session when Allow All sets acceptEdits
  if (behavior === 'allowAll') {
    ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: { permissionMode: 'acceptEdits', updatedAt: new Date() }
    });
  }
}

export function execShellCommand(sessionId, command, cwd, userId) {
  const TIMEOUT_MS = 30000;
  const MAX_OUTPUT = 50000;

  exec(command, {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    shell: '/bin/bash',
    env: { ...process.env },
  }, Meteor.bindEnvironment(async (error, stdout, stderr) => {
    let output = '';
    if (stdout) output += stdout;
    if (stderr) output += (output ? '\n' : '') + stderr;

    let truncated = false;
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT);
      truncated = true;
    }

    const exitCode = error ? (error.killed ? null : error.code || 1) : 0;
    const timedOut = error?.killed;

    let status = '';
    if (timedOut) status = `\n[Timeout after ${TIMEOUT_MS / 1000}s]`;
    else if (exitCode !== 0 && exitCode !== null) status = `\n[Exit code: ${exitCode}]`;
    if (truncated) status += `\n[Output truncated]`;

    await ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'system',
      type: 'shell_result',
      content: [{ type: 'text', text: (output || '(no output)') + status }],
      contentText: (output || '(no output)') + status,
      shellCommand: command,
      shellExitCode: exitCode,
      userId,
      createdAt: new Date(),
    });
  }));
}

export function execCodexCommand(sessionId, prompt, cwd, options = {}, userId) {
  const TIMEOUT_MS = 300000; // 5 minutes
  const MAX_OUTPUT = 100000;

  if (!codexBin || codexBin === 'codex') {
    // codex not found - insert error message
    ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'system',
      type: 'codex_result',
      content: [{ type: 'text', text: 'Error: codex CLI not found. Install with: npm install -g @openai/codex' }],
      contentText: 'Error: codex CLI not found',
      codexPrompt: prompt,
      codexExitCode: 1,
      userId,
      createdAt: new Date(),
    });
    // Clear codexRunning flag
    ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: { codexRunning: false, updatedAt: new Date() }
    });
    return;
  }

  log('execCodex:', prompt.slice(0, 100));

  const codexArgs = ['exec', '--json', '--full-auto', '-C', cwd];
  if (options.model) codexArgs.push('--model', options.model);
  if (options.reasoningEffort) codexArgs.push('-c', `model_reasoning_effort="${options.reasoningEffort}"`);
  codexArgs.push(prompt);

  const proc = spawn(codexBin, codexArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let buffer = '';
  const items = [];
  let usage = null;

  proc.stdout.on('data', Meteor.bindEnvironment((chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'item.completed') {
          items.push(event.item);
        } else if (event.type === 'turn.completed') {
          usage = event.usage;
        }
      } catch (_) {
        // Ignore non-JSON lines
      }
    }
  }));

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const timeout = setTimeout(() => {
    log('execCodex timeout, killing');
    proc.kill('SIGKILL');
  }, TIMEOUT_MS);

  proc.on('close', Meteor.bindEnvironment(async (code) => {
    clearTimeout(timeout);
    log('execCodex closed, code:', code, 'items:', items.length);

    // Build result content
    const content = [];
    for (const item of items) {
      if (item.type === 'command_execution') {
        let output = item.aggregated_output || '(no output)';
        if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[truncated]';
        content.push({
          type: 'text',
          text: `\`\`\`bash\n$ ${item.command}\n${output}\`\`\``
        });
      } else if (item.type === 'agent_message') {
        content.push({ type: 'text', text: item.text });
      }
    }

    if (content.length === 0) {
      if (stderr) {
        content.push({ type: 'text', text: `Error: ${stderr}` });
      } else {
        content.push({ type: 'text', text: '(no output from codex)' });
      }
    }

    const contentText = content.map(c => c.text).join('\n\n');

    await ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'system',
      type: 'codex_result',
      content,
      contentText,
      codexPrompt: prompt,
      codexExitCode: code,
      codexUsage: usage,
      userId,
      createdAt: new Date(),
    });

    // Clear codexRunning flag
    await ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: { codexRunning: false, updatedAt: new Date() }
    });

    // Inject a system message so Claude knows about the Codex exchange
    if (code === 0 && contentText) {
      const summary = `[Codex exchange] User asked: "${prompt.slice(0, 200)}"\nCodex responded:\n${contentText.slice(0, 2000)}`;
      await ClaudeMessagesCollection.insertAsync({
        sessionId,
        role: 'system',
        type: 'codex_context',
        content: [{ type: 'text', text: summary }],
        contentText: summary,
        userId,
        createdAt: new Date(),
      });
    }
  }));
}

export async function spawnClaudeProcess(session, message) {
  const sessionId = session._id;
  const userId = session.userId;
  log('--- spawnClaudeProcess ---');
  const messagePreview = typeof message === 'string' ? message.slice(0, 100) : `[${message.length} content blocks]`;
  log('sessionId:', sessionId, 'message:', messagePreview);

  // Kill any existing process for this session
  if (activeProcesses.has(sessionId)) {
    await killProcess(sessionId);
  }

  // Build args — prompt is sent via stdin (stream-json), not -p
  const args = ['--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--input-format', 'stream-json'];

  if (session.claudeSessionId) {
    args.push('--resume', session.claudeSessionId);
  }

  if (session.model) {
    args.push('--model', session.model);
  }

  if (session.permissionMode) {
    args.push('--permission-mode', session.permissionMode);
  }

  if (session.appendSystemPrompt) {
    args.push('--append-system-prompt', session.appendSystemPrompt);
  }

  let cwd = session.cwd || process.env.HOME + '/projects';
  if (cwd.startsWith('~/')) cwd = path.join(process.env.HOME, cwd.slice(2));
  log('args:', args.join(' '));
  log('cwd:', cwd);

  const spawnEnv = { ...process.env, PANORAMA_SESSION: sessionId };
  if (session.claudeEffort) {
    const effortToTokens = { low: 8000, medium: 16000, high: 31999, max: 63999 };
    const tokens = effortToTokens[session.claudeEffort];
    if (tokens) spawnEnv.MAX_THINKING_TOKENS = String(tokens);
  }

  const proc = spawn(claudeBin, args, {
    cwd,
    env: spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Attach error handler IMMEDIATELY (before any await) to prevent unhandled 'error' crash
  proc.on('error', Meteor.bindEnvironment(async (err) => {
    logError('spawn error:', err.message);
    activeProcesses.delete(sessionId);
    await ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: {
        status: 'error',
        lastError: err.message,
        updatedAt: new Date(),
      }
    });
  }));

  log('spawned pid:', proc.pid);
  activeProcesses.set(sessionId, proc);

  // Update session status with PID
  await ClaudeSessionsCollection.updateAsync(sessionId, {
    $set: { status: 'running', pid: proc.pid, lastError: null, updatedAt: new Date() }
  });

  // Send prompt via stdin (stream-json format)
  const stdinMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: message } });
  proc.stdin.write(stdinMsg + '\n');
  log('sent prompt via stdin');

  let currentAssistantMsgId = null;
  let buffer = '';
  let lineCount = 0;

  const processLine = Meteor.bindEnvironment(async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    lineCount++;
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (_) {
      log(`line #${lineCount} not JSON:`, trimmed.slice(0, 200));
      return;
    }

    const type = data.type;
    const subtype = data.subtype;
    log(`line #${lineCount} type=${type} subtype=${subtype}`);

    // --- init ---
    if (type === 'system' && subtype === 'init') {
      const claudeSessionId = data.session_id;
      log('init → claudeSessionId:', claudeSessionId, 'version:', data.claude_code_version, 'model:', data.model);
      const initUpdate = { updatedAt: new Date() };
      if (claudeSessionId) initUpdate.claudeSessionId = claudeSessionId;
      if (data.claude_code_version) initUpdate.claudeCodeVersion = data.claude_code_version;
      if (data.model) initUpdate.activeModel = data.model;
      await ClaudeSessionsCollection.updateAsync(sessionId, { $set: initUpdate });
      return;
    }

    // --- assistant message ---
    if (type === 'assistant') {
      const contentBlocks = data.message?.content || [];
      const contentText = contentBlocks
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      log('assistant message, blocks:', contentBlocks.length, 'text:', contentText.slice(0, 100));

      const msgDoc = {
        sessionId,
        role: 'assistant',
        type: 'assistant',
        content: contentBlocks,
        contentText,
        claudeSessionId: data.session_id,
        model: data.message?.model,
        isStreaming: false,
        userId,
        createdAt: new Date(),
      };

      currentAssistantMsgId = await ClaudeMessagesCollection.insertAsync(msgDoc);
      log('inserted assistant msg', currentAssistantMsgId);
      return;
    }

    // --- result ---
    if (type === 'result') {
      const isError = subtype === 'error_during_execution' || subtype === 'error';
      const errorMsg = data.error || data.result?.error;

      log('result subtype:', subtype, 'isError:', isError, 'errorMsg:', errorMsg);
      log('result raw (200 chars):', JSON.stringify(data).slice(0, 200));

      // On error: store error on session, reset claudeSessionId if resume failed
      if (isError) {
        const errText = errorMsg || `Claude exited with error: ${subtype}`;
        logError('result error:', errText);

        // Insert error as system message so user sees it
        await ClaudeMessagesCollection.insertAsync({
          sessionId,
          role: 'system',
          type: 'error',
          content: [{ type: 'text', text: errText }],
          contentText: errText,
          userId,
          createdAt: new Date(),
        });

        const errorUpdate = {
          lastError: errText,
          claudeSessionId: null, // reset so next message starts fresh
          updatedAt: new Date(),
        };
        if (!hasQueuedMessages(sessionId)) {
          errorUpdate.status = 'error';
          errorUpdate.unseenCompleted = true;
        }
        await ClaudeSessionsCollection.updateAsync(sessionId, { $set: errorUpdate });
        currentAssistantMsgId = null;
        // Remove finished process before draining queue so spawnClaudeProcess
        // won't call killProcess (which clears the queue)
        const errProc = activeProcesses.get(sessionId);
        if (errProc === proc) {
          activeProcesses.delete(sessionId);
          pendingPermissions.delete(sessionId);
        }
        drainQueue(sessionId);
        return;
      }

      const contentBlocks = data.result?.content || data.content || [];
      const contentText = contentBlocks
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      log('result blocks:', contentBlocks.length, 'cost:', data.cost_usd, 'duration:', data.duration_ms);

      if (currentAssistantMsgId) {
        const msgUpdate = {
            isStreaming: false,
            durationMs: data.duration_ms,
            usage: data.usage,
            costUsd: data.cost_usd,
        };
        if (contentBlocks.length > 0) msgUpdate.content = contentBlocks;
        if (contentText) msgUpdate.contentText = contentText;
        await ClaudeMessagesCollection.updateAsync(currentAssistantMsgId, {
          $set: msgUpdate
        });
        log('updated assistant msg with result stats', currentAssistantMsgId);
      } else if (contentBlocks.length > 0) {
        const id = await ClaudeMessagesCollection.insertAsync({
          sessionId,
          role: 'assistant',
          type: 'result',
          content: contentBlocks,
          contentText,
          claudeSessionId: data.session_id,
          model: data.model,
          durationMs: data.duration_ms,
          usage: data.usage,
          costUsd: data.cost_usd,
          isStreaming: false,
          userId,
          createdAt: new Date(),
        });
        log('inserted result msg', id);
      } else {
        log('result with no content blocks, skipping insert');
      }

      // Update session stats — keep 'running' if queue has pending messages
      const sessionUpdate = {
        updatedAt: new Date(),
      };
      if (!hasQueuedMessages(sessionId)) {
        sessionUpdate.status = 'idle';
        sessionUpdate.unseenCompleted = true;
      }
      if (data.modelUsage) {
        sessionUpdate.lastModelUsage = data.modelUsage;
      }
      const sessionInc = {};
      if (data.cost_usd != null) sessionInc.totalCostUsd = data.cost_usd;
      if (data.duration_ms != null) sessionInc.totalDurationMs = data.duration_ms;
      const modifier = { $set: sessionUpdate };
      if (Object.keys(sessionInc).length > 0) modifier.$inc = sessionInc;
      await ClaudeSessionsCollection.updateAsync(sessionId, modifier);
      log('session → idle, stats updated');
      currentAssistantMsgId = null;
      // Remove finished process before draining queue so spawnClaudeProcess
      // won't call killProcess (which clears the queue)
      const doneProc = activeProcesses.get(sessionId);
      if (doneProc === proc) {
        activeProcesses.delete(sessionId);
        pendingPermissions.delete(sessionId);
      }
      drainQueue(sessionId);
      return;
    }

    // --- control_request (permission prompt via stdin/stdout) ---
    if (type === 'control_request') {
      const requestId = data.request_id;
      const toolName = data.request?.tool_name;
      const toolInput = data.request?.input;
      log('control_request:', requestId, 'tool:', toolName);

      // Check current session mode — auto-respond if mode allows this tool
      const currentSession = await ClaudeSessionsCollection.findOneAsync(sessionId);
      const mode = currentSession?.permissionMode || '';

      if (shouldAutoAllow(mode, toolName)) {
        log('auto-allowing', toolName, 'per current mode:', mode);
        const autoResponse = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: { behavior: 'allow', updatedInput: toolInput },
          },
        };
        proc.stdin.write(JSON.stringify(autoResponse) + '\n');
        return;
      }

      pendingPermissions.set(sessionId, { requestId, toolName, toolInput });

      const text = `Tool **${toolName}** requires permission.`;
      await ClaudeMessagesCollection.insertAsync({
        sessionId,
        role: 'system',
        type: 'permission_request',
        content: [{ type: 'text', text }],
        contentText: text,
        toolName,
        toolInput,
        userId,
        createdAt: new Date(),
      });
      return;
    }

    // --- user message (permission requests — legacy fallback) ---
    if (type === 'user') {
      const contentBlocks = data.message?.content || [];
      const permissionTexts = contentBlocks
        .filter(b => b.type === 'tool_result' && typeof b.content === 'string' && b.content.includes('requested permissions'))
        .map(b => b.content);

      if (permissionTexts.length > 0) {
        const text = permissionTexts.join('\n');
        log('permission request detected (legacy):', text.slice(0, 200));
        await ClaudeMessagesCollection.insertAsync({
          sessionId,
          role: 'system',
          type: 'permission_request',
          content: [{ type: 'text', text }],
          contentText: text,
          userId,
          createdAt: new Date(),
        });
        return;
      }

      // Skip tool results — they clutter the conversation with raw file contents
      if (contentBlocks.length > 0) {
        return;
      }
    }

    log(`unhandled type=${type} subtype=${subtype}`, JSON.stringify(data));
  });

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      processLine(line);
    }
  });

  proc.stderr.on('data', Meteor.bindEnvironment(async (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      logError('stderr:', text);
    }
  }));

  proc.on('exit', Meteor.bindEnvironment(async (code, signal) => {
    log(`exit code=${code} signal=${signal} lines=${lineCount} bufferLeft=${buffer.length}`);
    // Only clean up if this is still the active process (avoids race when a new process was spawned)
    if (activeProcesses.get(sessionId) === proc) {
      activeProcesses.delete(sessionId);
      pendingPermissions.delete(sessionId);
    } else {
      log('exit from stale process, skipping cleanup (new process already active)');
      return;
    }

    // Process remaining buffer
    if (buffer.trim()) {
      log('processing remaining buffer:', buffer.slice(0, 200));
      await processLine(buffer);
      buffer = '';
    }

    // If exit was abnormal and status is still running, set error (or drain queue)
    const currentSession = await ClaudeSessionsCollection.findOneAsync(sessionId);
    if (currentSession?.status === 'running') {
      const isError = code !== 0 && signal !== 'SIGTERM';
      const exitUpdate = { updatedAt: new Date() };
      if (!hasQueuedMessages(sessionId)) {
        exitUpdate.status = isError ? 'error' : 'idle';
        exitUpdate.lastError = isError ? `Process exited with code ${code}` : null;
        log('session still running after exit, setting', exitUpdate.status);
      } else {
        log('session still running after exit, queue has messages — keeping running');
      }
      await ClaudeSessionsCollection.updateAsync(sessionId, { $set: exitUpdate });
      drainQueue(sessionId);
    }
  }));
}

// ============================================================
// Debate: Claude Code vs Codex back-and-forth
// ============================================================

const DEBATE_MAX_ROUNDS = 5;
const DEBATE_TIMEOUT_MS = 300000; // 5 min per turn
const DEBATE_MAX_OUTPUT = 100000;

function parseConsensusTag(text) {
  if (!text) return null;
  const lastAgree = text.lastIndexOf('[AGREE]');
  const lastDisagree = text.lastIndexOf('[DISAGREE]');
  if (lastAgree === -1 && lastDisagree === -1) return null;
  return lastAgree > lastDisagree;
}

function buildCodexPrompt(subject, history, round) {
  let prompt = `You are Codex (OpenAI) participating in a structured debate with Claude Code (Anthropic) about:\n\n"${subject}"\n\n`;
  if (history.length > 0) {
    prompt += 'Previous turns:\n\n';
    for (const turn of history) {
      prompt += `--- ${turn.agent.toUpperCase()} (Round ${turn.round}) ---\n${turn.text}\n\n`;
    }
    prompt += '---\n\n';
  }
  if (round === 1) {
    prompt += 'You go first. Provide your analysis.';
  } else {
    prompt += `It is your turn (Round ${round}). Respond to the points made above.\n\n`;
    prompt += 'At the end of your response, you MUST include exactly one of these tags on its own line:\n[AGREE] - if you agree with the other agent or believe consensus is reached\n[DISAGREE] - if you disagree and want to continue the debate';
  }
  return prompt;
}

function buildClaudePrompt(subject, history, round) {
  let prompt = `You are Claude Code (Anthropic) participating in a structured debate with Codex (OpenAI) about:\n\n"${subject}"\n\n`;
  prompt += 'Previous turns:\n\n';
  for (const turn of history) {
    prompt += `--- ${turn.agent.toUpperCase()} (Round ${turn.round}) ---\n${turn.text}\n\n`;
  }
  prompt += '---\n\n';
  prompt += `It is your turn (Round ${round}). Respond to the points made above.\n\n`;
  prompt += 'At the end of your response, you MUST include exactly one of these tags on its own line:\n[AGREE] - if you agree with the other agent or believe consensus is reached\n[DISAGREE] - if you disagree and want to continue the debate';
  return prompt;
}

function runCodexTurn(sessionId, prompt, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    if (!codexBin || codexBin === 'codex') {
      return reject(new Error('codex CLI not found. Install with: npm install -g @openai/codex'));
    }

    const debate = activeDebates.get(sessionId);

    const codexArgs = ['exec', '--json', '--full-auto', '-C', cwd];
    if (options.model) codexArgs.push('--model', options.model);
    if (options.reasoningEffort) codexArgs.push('-c', `model_reasoning_effort="${options.reasoningEffort}"`);
    codexArgs.push(prompt);

    log('debate codex spawn:', codexBin, codexArgs.slice(0, -1).join(' '), prompt.slice(0, 80));
    const proc = spawn(codexBin, codexArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    log('debate codex pid:', proc.pid);
    if (debate) debate.currentProc = proc;

    let buffer = '';
    const items = [];
    let usage = null;
    let stderr = '';

    proc.stdout.on('data', Meteor.bindEnvironment((chunk) => {
      const text = chunk.toString();
      log('debate codex stdout chunk:', text.length, 'chars');
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          log('debate codex event:', event.type);
          if (event.type === 'item.completed') items.push(event.item);
          else if (event.type === 'turn.completed') usage = event.usage;
        } catch { /* skip malformed JSON lines */ }
      }
    }));

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      log('debate codex stderr:', chunk.toString().slice(0, 200));
    });

    const timeout = setTimeout(() => {
      log('debate codex timeout, killing');
      try { proc.kill('SIGKILL'); } catch { /* process may already be dead */ }
      reject(new Error('Codex turn timeout'));
    }, DEBATE_TIMEOUT_MS);

    proc.on('close', Meteor.bindEnvironment((code) => {
      clearTimeout(timeout);
      log('debate codex closed, code:', code, 'items:', items.length, 'stderr:', stderr.slice(0, 200));
      if (debate) debate.currentProc = null;

      // Only keep agent_message items (the summary), not command_execution (file reads etc.)
      const parts = [];
      for (const item of items) {
        if (item.type === 'agent_message' && item.text) {
          parts.push(item.text);
        }
      }
      if (parts.length === 0) {
        parts.push(stderr ? `Error: ${stderr}` : '(no output from codex)');
      }
      const text = parts.join('\n\n');
      log('debate codex result text:', text.slice(0, 200));
      resolve({ text, agreed: parseConsensusTag(text), exitCode: code, usage });
    }));

    proc.on('error', (err) => {
      clearTimeout(timeout);
      logError('debate codex spawn error:', err.message);
      if (debate) debate.currentProc = null;
      reject(err);
    });
  });
}

function runClaudeTurn(sessionId, prompt, cwd, session) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (session.model) args.push('--model', session.model);
    args.push('--permission-mode', 'plan');

    const debate = activeDebates.get(sessionId);

    log('debate claude spawn:', claudeBin, args.slice(0, 5).join(' '), '...');
    const proc = spawn(claudeBin, args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    log('debate claude pid:', proc.pid);
    // Close stdin immediately — with -p, Claude reads the prompt from args, not stdin
    proc.stdin.end();
    if (debate) debate.currentProc = proc;

    let buffer = '';
    let resultText = '';

    proc.stdout.on('data', Meteor.bindEnvironment((chunk) => {
      const text = chunk.toString();
      log('debate claude stdout chunk:', text.length, 'chars');
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          log('debate claude event:', data.type, data.subtype || '');
          if (data.type === 'assistant') {
            const blocks = data.message?.content || [];
            const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text) resultText = text;
          }
          if (data.type === 'result' && data.subtype !== 'error' && data.subtype !== 'error_during_execution') {
            const blocks = data.result?.content || data.content || [];
            const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text) resultText = text;
          }
        } catch { /* skip malformed JSON lines */ }
      }
    }));

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      log('debate claude stderr:', chunk.toString().slice(0, 200));
    });

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* process may already be dead */ }
      reject(new Error('Claude turn timeout'));
    }, DEBATE_TIMEOUT_MS);

    proc.on('close', Meteor.bindEnvironment((code) => {
      clearTimeout(timeout);
      log('debate claude closed, code:', code, 'resultText:', resultText.slice(0, 200));
      if (debate) debate.currentProc = null;

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim());
          if (data.type === 'assistant') {
            const blocks = data.message?.content || [];
            const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text) resultText = text;
          }
          if (data.type === 'result' && data.subtype !== 'error' && data.subtype !== 'error_during_execution') {
            const blocks = data.result?.content || data.content || [];
            const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text) resultText = text;
          }
        } catch { /* skip malformed JSON in remaining buffer */ }
      }

      if (!resultText && stderr) resultText = `Error: ${stderr}`;
      if (!resultText) resultText = '(no output from claude)';

      log('debate claude final text:', resultText.slice(0, 200));
      resolve({ text: resultText, agreed: parseConsensusTag(resultText), exitCode: code });
    }));

    proc.on('error', (err) => {
      clearTimeout(timeout);
      logError('debate claude spawn error:', err.message);
      if (debate) debate.currentProc = null;
      reject(err);
    });
  });
}

async function clearDebateFlags(sessionId) {
  await ClaudeSessionsCollection.updateAsync(sessionId, {
    $set: { debateRunning: false, debateRound: null, debateCurrentAgent: null, debateSubject: null, updatedAt: new Date() }
  });
}

async function insertDebateTurn(sessionId, agent, round, text, agreed, userId) {
  await ClaudeMessagesCollection.insertAsync({
    sessionId,
    role: 'system',
    type: 'debate_turn',
    content: [{ type: 'text', text }],
    contentText: text,
    debateAgent: agent,
    debateRound: round,
    debateAgreed: agreed,
    userId,
    createdAt: new Date(),
  });
}

async function insertDebateSummary(sessionId, rounds, outcome, userId) {
  const messages = {
    consensus: `Debate ended: consensus reached after ${rounds} round(s).`,
    max_rounds: `Debate ended: max ${rounds} rounds reached without full consensus.`,
    stopped: 'Debate stopped by user.',
    error: 'Debate ended due to an error.',
  };
  await ClaudeMessagesCollection.insertAsync({
    sessionId,
    role: 'system',
    type: 'debate_summary',
    content: [{ type: 'text', text: messages[outcome] || `Debate ended: ${outcome}` }],
    contentText: messages[outcome] || `Debate ended: ${outcome}`,
    debateRounds: rounds,
    debateOutcome: outcome,
    userId,
    createdAt: new Date(),
  });
}

export async function execDebate(sessionId, subject, cwd, session) {
  const debateState = { aborted: false, currentProc: null };
  activeDebates.set(sessionId, debateState);
  const history = [];
  const userId = session.userId;

  log('debate start:', subject.slice(0, 100));

  try {
    for (let round = 1; round <= DEBATE_MAX_ROUNDS; round++) {
      if (debateState.aborted) break;

      // --- Codex turn ---
      await ClaudeSessionsCollection.updateAsync(sessionId, {
        $set: { debateRound: round, debateCurrentAgent: 'codex', updatedAt: new Date() }
      });

      const codexPrompt = buildCodexPrompt(subject, history, round);
      log(`debate round ${round} codex turn`);
      const codexResult = await runCodexTurn(sessionId, codexPrompt, cwd, {
        model: session.codexModel,
        reasoningEffort: session.codexReasoningEffort,
      });

      if (debateState.aborted) break;

      await insertDebateTurn(sessionId, 'codex', round, codexResult.text, codexResult.agreed, userId);
      history.push({ agent: 'codex', round, text: codexResult.text });

      if (debateState.aborted) break;

      // --- Claude turn ---
      await ClaudeSessionsCollection.updateAsync(sessionId, {
        $set: { debateCurrentAgent: 'claude', updatedAt: new Date() }
      });

      const claudePrompt = buildClaudePrompt(subject, history, round);
      log(`debate round ${round} claude turn`);
      const claudeResult = await runClaudeTurn(sessionId, claudePrompt, cwd, session);

      if (debateState.aborted) break;

      await insertDebateTurn(sessionId, 'claude', round, claudeResult.text, claudeResult.agreed, userId);
      history.push({ agent: 'claude', round, text: claudeResult.text });

      // Check consensus
      if (codexResult.agreed && claudeResult.agreed) {
        log(`debate consensus at round ${round}`);
        await insertDebateSummary(sessionId, round, 'consensus', userId);
        return;
      }

      if (round === DEBATE_MAX_ROUNDS) {
        log('debate max rounds reached');
        await insertDebateSummary(sessionId, round, 'max_rounds', userId);
        return;
      }
    }

    // If we broke out of the loop due to abort
    if (debateState.aborted) {
      log('debate aborted');
      const currentRound = history.length > 0 ? history[history.length - 1].round : 0;
      await insertDebateSummary(sessionId, currentRound, 'stopped', userId);
    }
  } catch (err) {
    logError('debate error:', err.message);
    const currentRound = history.length > 0 ? history[history.length - 1].round : 0;
    await insertDebateSummary(sessionId, currentRound, 'error', userId);
  } finally {
    activeDebates.delete(sessionId);
    await clearDebateFlags(sessionId);
    log('debate cleanup done for', sessionId);
  }
}

export function stopDebate(sessionId) {
  const debate = activeDebates.get(sessionId);
  if (!debate) return;

  log('stopping debate for', sessionId);
  debate.aborted = true;

  if (debate.currentProc) {
    try { debate.currentProc.kill('SIGTERM'); } catch { /* process may already be dead */ }
    setTimeout(() => {
      try { debate.currentProc?.kill('SIGKILL'); } catch { /* process may already be dead */ }
    }, 3000);
  }
}
