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

// --- File logger ---
const LOG_FILE = path.join(process.env.HOME || '/tmp', '.panorama-claude.log');

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
  });
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
      try { proc.kill('SIGKILL'); } catch (_) {}
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

export function execShellCommand(sessionId, command, cwd) {
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
      createdAt: new Date(),
    });
  }));
}

export async function spawnClaudeProcess(session, message) {
  const sessionId = session._id;
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

  const proc = spawn(claudeBin, args, {
    cwd,
    env: { ...process.env, PANORAMA_SESSION: sessionId },
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
        await ClaudeMessagesCollection.updateAsync(currentAssistantMsgId, {
          $set: {
            content: contentBlocks.length > 0 ? contentBlocks : undefined,
            contentText: contentText || undefined,
            isStreaming: false,
            durationMs: data.duration_ms,
            usage: data.usage,
            costUsd: data.cost_usd,
          }
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
      if (data.cost_usd != null) {
        sessionUpdate.totalCostUsd = (session.totalCostUsd || 0) + data.cost_usd;
      }
      if (data.duration_ms != null) {
        sessionUpdate.totalDurationMs = (session.totalDurationMs || 0) + data.duration_ms;
      }
      if (data.modelUsage) {
        sessionUpdate.lastModelUsage = data.modelUsage;
      }
      await ClaudeSessionsCollection.updateAsync(sessionId, { $set: sessionUpdate });
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
          createdAt: new Date(),
        });
        return;
      }

      // Save tool results / user context messages
      if (contentBlocks.length > 0) {
        const contentText = contentBlocks
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n');
        await ClaudeMessagesCollection.insertAsync({
          sessionId,
          role: 'user',
          type: 'tool_result',
          content: contentBlocks,
          contentText,
          createdAt: new Date(),
        });
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
