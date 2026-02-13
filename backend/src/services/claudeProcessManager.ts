import { spawn, exec, execSync, ChildProcess } from 'child_process';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { ClaudeSession, ClaudeMessage } from '../models/index.js';

// Resolve claude binary path at startup
let claudeBin = 'claude';
try {
  claudeBin = execSync('which claude', { encoding: 'utf8' }).trim();
} catch {
  console.warn('[claude-pm] "claude" not found in PATH, spawn will likely fail');
}

// Resolve codex binary path at startup
let codexBin = 'codex';
try {
  codexBin = execSync('which codex', { encoding: 'utf8' }).trim();
} catch {
  console.warn('[claude-pm] "codex" not found in PATH');
}

function log(...args: unknown[]) {
  console.log('[claude-pm]', ...args);
}

function logError(...args: unknown[]) {
  console.error('[claude-pm]', ...args);
}

// In-memory maps
const activeProcesses = new Map<string, ChildProcess>();
const pendingPermissions = new Map<string, { requestId: string; toolName: string; toolInput: Record<string, unknown> }>();
const messageQueues = new Map<string, { msgId: string; content: unknown }[]>();

let io: SocketIOServer | null = null;

export function initProcessManager(socketIo: SocketIOServer) {
  io = socketIo;
  log('process manager initialized');
}

// --- Socket.io emission helpers ---

function emitToSession(sessionId: string, event: string, data: unknown) {
  io?.to(`claude:session:${sessionId}`).emit(event, data);
}

function emitToProject(projectId: string, event: string, data: unknown) {
  io?.to(`claude:project:${projectId}`).emit(event, data);
}

function emitGlobal(event: string, data: unknown) {
  io?.to('claude').emit(event, data);
}

async function emitSessionUpdate(sessionId: string) {
  const session = await ClaudeSession.findById(sessionId);
  if (!session) return;
  const data = session.toObject();
  emitToSession(sessionId, 'claude:session:updated', data);
  emitToProject(session.projectId.toString(), 'claude:session:updated', data);
}

export function emitMessageCreated(msg: any) {
  const sessionId = String(msg.sessionId);
  log('emitMessageCreated → room:', `claude:session:${sessionId}`, 'msgId:', String(msg._id), 'type:', msg.type);
  emitToSession(sessionId, 'claude:message:created', msg);
}

function emitMessageUpdated(msg: any) {
  const sessionId = String(msg.sessionId);
  emitToSession(sessionId, 'claude:message:updated', msg);
}

// --- Queue management ---

export function queueMessage(sessionId: string, message: unknown, msgId: string) {
  if (!messageQueues.has(sessionId)) messageQueues.set(sessionId, []);
  messageQueues.get(sessionId)!.push({ msgId, content: message });
  log('queued message for', sessionId, '| msgId:', msgId, '| queue size:', messageQueues.get(sessionId)!.length);
  syncQueueCount(sessionId);
}

export async function clearQueue(sessionId: string) {
  const q = messageQueues.get(sessionId);
  if (q?.length) {
    log('clearing queue for', sessionId, '| discarding', q.length, 'messages');
    for (const entry of q) {
      if (entry.msgId) {
        await ClaudeMessage.findByIdAndUpdate(entry.msgId, { $unset: { queued: 1 } });
      }
    }
  }
  messageQueues.delete(sessionId);
  syncQueueCount(sessionId);
}

export async function dequeueMessage(sessionId: string, msgId: string): Promise<boolean> {
  const q = messageQueues.get(sessionId);
  if (!q) return false;
  const idx = q.findIndex(entry => entry.msgId === msgId);
  if (idx === -1) return false;
  q.splice(idx, 1);
  if (q.length === 0) messageQueues.delete(sessionId);
  log('dequeued message', msgId, 'for', sessionId);
  syncQueueCount(sessionId);
  return true;
}

function hasQueuedMessages(sessionId: string): boolean {
  return (messageQueues.get(sessionId)?.length || 0) > 0;
}

function syncQueueCount(sessionId: string) {
  const count = messageQueues.get(sessionId)?.length || 0;
  ClaudeSession.findByIdAndUpdate(sessionId, {
    $set: { queuedCount: count, updatedAt: new Date() },
  }).catch(err => logError('syncQueueCount failed:', err.message));
  emitSessionUpdate(sessionId);
}

async function drainQueue(sessionId: string) {
  const q = messageQueues.get(sessionId);
  if (!q?.length) return;
  const entry = q.shift()!;
  if (q.length === 0) messageQueues.delete(sessionId);
  log('drainQueue for', sessionId, '| processing next message');
  syncQueueCount(sessionId);
  if (entry.msgId) {
    await ClaudeMessage.findByIdAndUpdate(entry.msgId, {
      $unset: { queued: 1 },
      $set: { createdAt: new Date() },
    });
  }
  const session = await ClaudeSession.findById(sessionId);
  if (session) {
    spawnClaudeProcess(session, entry.content);
  }
}

// --- Process management ---

export function isRunning(sessionId: string): boolean {
  return activeProcesses.has(sessionId);
}

export async function killProcess(sessionId: string) {
  await clearQueue(sessionId);
  pendingPermissions.delete(sessionId);
  const proc = activeProcesses.get(sessionId);
  if (!proc) {
    log('killProcess: no process for', sessionId);
    return;
  }

  log('killing process for', sessionId);
  activeProcesses.delete(sessionId);

  await new Promise<void>((resolve) => {
    const forceKillTimer = setTimeout(() => {
      log('killProcess: SIGTERM timeout, sending SIGKILL for', sessionId);
      try { proc.kill('SIGKILL'); } catch {}
      setTimeout(resolve, 500);
    }, 5000);

    proc.once('exit', () => {
      clearTimeout(forceKillTimer);
      log('killProcess: process exited for', sessionId);
      resolve();
    });

    proc.kill('SIGTERM');
  });

  await ClaudeSession.findByIdAndUpdate(sessionId, {
    $set: { status: 'idle', pid: null, updatedAt: new Date() },
  });
  emitSessionUpdate(sessionId);
  drainQueue(sessionId);
}

// --- Permission logic ---

function shouldAutoAllow(permissionMode: string, toolName: string): boolean {
  if (permissionMode === 'bypassPermissions') return true;
  if (permissionMode === 'acceptEdits') {
    const editTools = ['Edit', 'Write', 'Read', 'NotebookEdit', 'MultiEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
    return editTools.includes(toolName);
  }
  return false;
}

export async function syncPermissionMode(sessionId: string, newMode: string) {
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

  proc.stdin!.write(JSON.stringify(response) + '\n');
  pendingPermissions.delete(sessionId);

  await ClaudeMessage.findOneAndUpdate(
    { sessionId, type: 'permission_request', toolName: pending.toolName, autoResponded: { $ne: true } },
    { $set: { autoResponded: true, autoRespondedMode: newMode } },
  );
}

export function respondToPermission(sessionId: string, behavior: string, updatedToolInput?: Record<string, unknown>) {
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

  log('respondToPermission:', sessionId, 'behavior:', behavior);
  proc.stdin!.write(JSON.stringify(response) + '\n');
  pendingPermissions.delete(sessionId);

  if (behavior === 'allowAll') {
    ClaudeSession.findByIdAndUpdate(sessionId, {
      $set: { permissionMode: 'acceptEdits', updatedAt: new Date() },
    }).then(() => emitSessionUpdate(sessionId));
  }
}

// --- Shell command ---

export function execShellCommand(sessionId: string, command: string, cwd: string) {
  const TIMEOUT_MS = 30000;
  const MAX_OUTPUT = 50000;

  exec(command, {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    shell: '/bin/bash',
    env: { ...process.env },
  }, async (error, stdout, stderr) => {
    let output = '';
    if (stdout) output += stdout;
    if (stderr) output += (output ? '\n' : '') + stderr;

    let truncated = false;
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT);
      truncated = true;
    }

    const exitCode = error ? (error.killed ? null : (error as any).code || 1) : 0;
    const timedOut = error?.killed;

    let status = '';
    if (timedOut) status = `\n[Timeout after ${TIMEOUT_MS / 1000}s]`;
    else if (exitCode !== 0 && exitCode !== null) status = `\n[Exit code: ${exitCode}]`;
    if (truncated) status += `\n[Output truncated]`;

    const msg = await ClaudeMessage.create({
      sessionId,
      role: 'system',
      type: 'shell_result',
      content: [{ type: 'text', text: (output || '(no output)') + status }],
      contentText: (output || '(no output)') + status,
      shellCommand: command,
      shellExitCode: exitCode,
    });

    emitMessageCreated(msg.toObject());
  });
}

// --- Main spawn ---

export async function spawnClaudeProcess(session: any, message: unknown) {
  const sessionId = session._id.toString();
  const messagePreview = typeof message === 'string' ? message.slice(0, 100) : `[content blocks]`;
  log('--- spawnClaudeProcess ---');
  log('sessionId:', sessionId, 'message:', messagePreview);

  if (activeProcesses.has(sessionId)) {
    await killProcess(sessionId);
  }

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

  let cwd = session.cwd || process.env.HOME || '/tmp';
  if (cwd.startsWith('~/')) cwd = path.join(process.env.HOME!, cwd.slice(2));
  log('args:', args.join(' '));
  log('cwd:', cwd);

  const spawnEnv: Record<string, string> = { ...process.env as Record<string, string>, PANORAMA_SESSION: sessionId };
  // Remove Claude Code nesting detection variables so we can spawn from within a Claude session
  delete spawnEnv.CLAUDECODE;
  delete spawnEnv.CLAUDE_CODE_ENTRYPOINT;
  if (session.claudeEffort) {
    const effortToTokens: Record<string, number> = { low: 8000, medium: 16000, high: 31999, max: 63999 };
    const tokens = effortToTokens[session.claudeEffort];
    if (tokens) spawnEnv.MAX_THINKING_TOKENS = String(tokens);
  }

  const proc = spawn(claudeBin, args, {
    cwd,
    env: spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.on('error', async (err) => {
    logError('spawn error:', err.message);
    activeProcesses.delete(sessionId);
    await ClaudeSession.findByIdAndUpdate(sessionId, {
      $set: { status: 'error', lastError: err.message, updatedAt: new Date() },
    });
    emitSessionUpdate(sessionId);
  });

  log('spawned pid:', proc.pid);
  activeProcesses.set(sessionId, proc);

  await ClaudeSession.findByIdAndUpdate(sessionId, {
    $set: { status: 'running', pid: proc.pid, lastError: null, updatedAt: new Date() },
  });
  emitSessionUpdate(sessionId);

  // Send prompt via stdin (stream-json format)
  const stdinMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: message } });
  proc.stdin!.write(stdinMsg + '\n');
  log('sent prompt via stdin');

  let currentAssistantMsgId: string | null = null;
  let buffer = '';
  let lineCount = 0;

  const processLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    lineCount++;
    let data: any;
    try {
      data = JSON.parse(trimmed);
    } catch {
      log(`line #${lineCount} not JSON:`, trimmed.slice(0, 200));
      return;
    }

    const type = data.type;
    const subtype = data.subtype;
    log(`line #${lineCount} type=${type} subtype=${subtype}`);

    // --- init ---
    if (type === 'system' && subtype === 'init') {
      const claudeSessionId = data.session_id;
      log('init → claudeSessionId:', claudeSessionId, 'model:', data.model);
      const initUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (claudeSessionId) initUpdate.claudeSessionId = claudeSessionId;
      if (data.claude_code_version) initUpdate.claudeCodeVersion = data.claude_code_version;
      if (data.model) initUpdate.activeModel = data.model;
      await ClaudeSession.findByIdAndUpdate(sessionId, { $set: initUpdate });
      emitSessionUpdate(sessionId);
      return;
    }

    // --- assistant message ---
    if (type === 'assistant') {
      const contentBlocks = data.message?.content || [];
      const contentText = contentBlocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');

      log('assistant message, blocks:', contentBlocks.length, 'text:', contentText.slice(0, 100));

      const msg = await ClaudeMessage.create({
        sessionId,
        role: 'assistant',
        type: 'assistant',
        content: contentBlocks,
        contentText,
        claudeSessionId: data.session_id,
        model: data.message?.model,
        isStreaming: false,
      });

      currentAssistantMsgId = msg._id.toString();
      log('inserted assistant msg', currentAssistantMsgId);
      emitMessageCreated(msg.toObject());
      return;
    }

    // --- result ---
    if (type === 'result') {
      const isError = subtype === 'error_during_execution' || subtype === 'error';
      const errorMsg = data.error || data.result?.error;

      log('result subtype:', subtype, 'isError:', isError);

      if (isError) {
        const errText = errorMsg || `Claude exited with error: ${subtype}`;
        logError('result error:', errText);

        const errMsg = await ClaudeMessage.create({
          sessionId,
          role: 'system',
          type: 'error',
          content: [{ type: 'text', text: errText }],
          contentText: errText,
        });
        emitMessageCreated(errMsg.toObject());

        const errorUpdate: Record<string, unknown> = {
          lastError: errText,
          claudeSessionId: null,
          updatedAt: new Date(),
        };
        if (!hasQueuedMessages(sessionId)) {
          errorUpdate.status = 'error';
          errorUpdate.unseenCompleted = true;
        }
        await ClaudeSession.findByIdAndUpdate(sessionId, { $set: errorUpdate });
        emitSessionUpdate(sessionId);
        currentAssistantMsgId = null;

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
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');

      log('result blocks:', contentBlocks.length, 'cost:', data.cost_usd, 'duration:', data.duration_ms);

      if (currentAssistantMsgId) {
        const msgUpdate: Record<string, unknown> = {
          isStreaming: false,
          durationMs: data.duration_ms,
          usage: data.usage,
          costUsd: data.cost_usd,
        };
        if (contentBlocks.length > 0) msgUpdate.content = contentBlocks;
        if (contentText) msgUpdate.contentText = contentText;
        await ClaudeMessage.findByIdAndUpdate(currentAssistantMsgId, { $set: msgUpdate });
        const updatedMsg = await ClaudeMessage.findById(currentAssistantMsgId);
        if (updatedMsg) emitMessageUpdated(updatedMsg.toObject());
        log('updated assistant msg with result stats', currentAssistantMsgId);
      } else if (contentBlocks.length > 0) {
        const msg = await ClaudeMessage.create({
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
        });
        emitMessageCreated(msg.toObject());
        log('inserted result msg', msg._id);
      }

      const sessionUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (!hasQueuedMessages(sessionId)) {
        sessionUpdate.status = 'idle';
        sessionUpdate.unseenCompleted = true;
      }
      if (data.modelUsage) sessionUpdate.lastModelUsage = data.modelUsage;

      const sessionInc: Record<string, number> = {};
      if (data.cost_usd != null) sessionInc.totalCostUsd = data.cost_usd;
      if (data.duration_ms != null) sessionInc.totalDurationMs = data.duration_ms;

      const modifier: Record<string, unknown> = { $set: sessionUpdate };
      if (Object.keys(sessionInc).length > 0) modifier.$inc = sessionInc;
      await ClaudeSession.findByIdAndUpdate(sessionId, modifier);
      emitSessionUpdate(sessionId);

      log('session → idle, stats updated');
      currentAssistantMsgId = null;

      const doneProc = activeProcesses.get(sessionId);
      if (doneProc === proc) {
        activeProcesses.delete(sessionId);
        pendingPermissions.delete(sessionId);
      }
      drainQueue(sessionId);
      return;
    }

    // --- control_request (permission prompt) ---
    if (type === 'control_request') {
      const requestId = data.request_id;
      const toolName = data.request?.tool_name;
      const toolInput = data.request?.input;
      log('control_request:', requestId, 'tool:', toolName);

      const currentSession = await ClaudeSession.findById(sessionId);
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
        proc.stdin!.write(JSON.stringify(autoResponse) + '\n');
        return;
      }

      pendingPermissions.set(sessionId, { requestId, toolName, toolInput });

      const text = `Tool **${toolName}** requires permission.`;
      const permMsg = await ClaudeMessage.create({
        sessionId,
        role: 'system',
        type: 'permission_request',
        content: [{ type: 'text', text }],
        contentText: text,
        toolName,
        toolInput,
      });
      emitMessageCreated(permMsg.toObject());
      return;
    }

    // --- user message (tool results — skip) ---
    if (type === 'user') {
      return;
    }

    log(`unhandled type=${type} subtype=${subtype}`);
  };

  proc.stdout!.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      processLine(line);
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) logError('stderr:', text);
  });

  proc.on('exit', async (code, signal) => {
    log(`exit code=${code} signal=${signal} lines=${lineCount}`);
    if (activeProcesses.get(sessionId) === proc) {
      activeProcesses.delete(sessionId);
      pendingPermissions.delete(sessionId);
    } else {
      log('exit from stale process, skipping cleanup');
      return;
    }

    if (buffer.trim()) {
      log('processing remaining buffer');
      await processLine(buffer);
      buffer = '';
    }

    const currentSession = await ClaudeSession.findById(sessionId);
    if (currentSession?.status === 'running') {
      const isError = code !== 0 && signal !== 'SIGTERM';
      const exitUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (!hasQueuedMessages(sessionId)) {
        exitUpdate.status = isError ? 'error' : 'idle';
        exitUpdate.lastError = isError ? `Process exited with code ${code}` : null;
      }
      await ClaudeSession.findByIdAndUpdate(sessionId, { $set: exitUpdate });
      emitSessionUpdate(sessionId);
      drainQueue(sessionId);
    }
  });
}
