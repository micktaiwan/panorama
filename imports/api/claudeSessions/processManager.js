import { Meteor } from 'meteor/meteor';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ClaudeSessionsCollection } from './collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';

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

// In-memory message queue: sessionId -> [string, ...]
const messageQueues = new Map();

export function queueMessage(sessionId, message) {
  if (!messageQueues.has(sessionId)) messageQueues.set(sessionId, []);
  messageQueues.get(sessionId).push(message);
  log('queued message for', sessionId, '| queue size:', messageQueues.get(sessionId).length);
  syncQueueCount(sessionId);
}

export function clearQueue(sessionId) {
  const q = messageQueues.get(sessionId);
  if (q?.length) log('clearing queue for', sessionId, '| discarding', q.length, 'messages');
  messageQueues.delete(sessionId);
  syncQueueCount(sessionId);
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
  const nextMsg = q.shift();
  if (q.length === 0) messageQueues.delete(sessionId);
  log('drainQueue for', sessionId, '| processing next message, remaining:', q?.length || 0);
  syncQueueCount(sessionId);
  const session = await ClaudeSessionsCollection.findOneAsync(sessionId);
  if (session) {
    spawnClaudeProcess(session, nextMsg);
  }
}

export function isRunning(sessionId) {
  return activeProcesses.has(sessionId);
}

export async function killProcess(sessionId) {
  clearQueue(sessionId);
  const proc = activeProcesses.get(sessionId);
  if (!proc) {
    log('killProcess: no process for', sessionId);
    return;
  }

  log('killing process for', sessionId);
  proc.kill('SIGTERM');

  const forceKillTimer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch (_) {}
  }, 5000);

  proc.once('exit', () => clearTimeout(forceKillTimer));
  activeProcesses.delete(sessionId);

  await ClaudeSessionsCollection.updateAsync(sessionId, {
    $set: { status: 'idle', updatedAt: new Date() }
  });
}

export async function spawnClaudeProcess(session, message) {
  const sessionId = session._id;
  log('--- spawnClaudeProcess ---');
  log('sessionId:', sessionId, 'message:', message.slice(0, 100));

  // Kill any existing process for this session
  if (activeProcesses.has(sessionId)) {
    await killProcess(sessionId);
  }

  // Build args
  const args = ['-p', message, '--output-format', 'stream-json', '--verbose'];

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

  const cwd = session.cwd || process.env.HOME + '/projects';
  log('args:', args.join(' '));
  log('cwd:', cwd);

  // Update session status
  await ClaudeSessionsCollection.updateAsync(sessionId, {
    $set: { status: 'running', lastError: null, updatedAt: new Date() }
  });

  const proc = spawn('claude', args, {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  log('spawned pid:', proc.pid);
  activeProcesses.set(sessionId, proc);

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
      log('init → claudeSessionId:', claudeSessionId);
      if (claudeSessionId) {
        await ClaudeSessionsCollection.updateAsync(sessionId, {
          $set: { claudeSessionId, updatedAt: new Date() }
        });
      }
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

      if (currentAssistantMsgId) {
        await ClaudeMessagesCollection.updateAsync(currentAssistantMsgId, { $set: msgDoc });
        log('updated assistant msg', currentAssistantMsgId);
        currentAssistantMsgId = null;
      } else {
        currentAssistantMsgId = await ClaudeMessagesCollection.insertAsync(msgDoc);
        log('inserted assistant msg', currentAssistantMsgId);
      }
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
        }
        await ClaudeSessionsCollection.updateAsync(sessionId, { $set: errorUpdate });
        currentAssistantMsgId = null;
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
      }
      if (data.cost_usd != null) {
        sessionUpdate.totalCostUsd = (session.totalCostUsd || 0) + data.cost_usd;
      }
      if (data.duration_ms != null) {
        sessionUpdate.totalDurationMs = (session.totalDurationMs || 0) + data.duration_ms;
      }
      await ClaudeSessionsCollection.updateAsync(sessionId, { $set: sessionUpdate });
      log('session → idle, stats updated');
      currentAssistantMsgId = null;
      drainQueue(sessionId);
      return;
    }

    log(`unhandled type=${type} subtype=${subtype}`, JSON.stringify(data).slice(0, 200));
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

  proc.on('exit', Meteor.bindEnvironment(async (code, signal) => {
    log(`exit code=${code} signal=${signal} lines=${lineCount} bufferLeft=${buffer.length}`);
    activeProcesses.delete(sessionId);

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
