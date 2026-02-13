import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api';

type SocketEventHandler = (...args: unknown[]) => void;

class SocketService {
  private socket: Socket | null = null;
  private eventHandlers: Map<string, Set<SocketEventHandler>> = new Map();

  connect(token: string) {
    if (this.socket?.connected) {
      return;
    }

    const baseUrl = getApiBaseUrl();

    this.socket = io(baseUrl, {
      auth: { token, clientType: 'web' },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      transports: ['polling', 'websocket'],
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.emit('internal:connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      this.emit('internal:disconnected', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      this.emit('internal:error', error.message);
    });

    // Re-emit server events to local handlers
    const events = [
      'user:online',
      'user:offline',
      'project:created', 'project:updated', 'project:deleted',
      'task:created', 'task:updated', 'task:deleted',
      'note:created', 'note:updated', 'note:deleted',
      'noteSession:created', 'noteSession:deleted',
      'noteLine:created',
      // Claude Code events
      'claude:message:created', 'claude:message:updated',
      'claude:session:updated',
      'claude:session:created', 'claude:session:deleted',
      'claude:project:updated',
    ];

    events.forEach((event) => {
      this.socket?.on(event, (...args) => {
        this.emit(event, ...args);
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, handler: SocketEventHandler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  private emit(event: string, ...args: unknown[]) {
    this.eventHandlers.get(event)?.forEach((handler) => handler(...args));
  }

  // Subscribe to data channels
  subscribeProjects() {
    this.socket?.emit('subscribe:projects');
  }
  unsubscribeProjects() {
    this.socket?.emit('unsubscribe:projects');
  }
  subscribeTasks() {
    this.socket?.emit('subscribe:tasks');
  }
  unsubscribeTasks() {
    this.socket?.emit('unsubscribe:tasks');
  }
  subscribeNotes() {
    this.socket?.emit('subscribe:notes');
  }
  unsubscribeNotes() {
    this.socket?.emit('unsubscribe:notes');
  }

  // Claude Code
  subscribeClaude() {
    this.socket?.emit('subscribe:claude');
  }
  unsubscribeClaude() {
    this.socket?.emit('unsubscribe:claude');
  }
  subscribeClaudeSession(sessionId: string) {
    this.socket?.emit('subscribe:claude:session', sessionId);
  }
  unsubscribeClaudeSession(sessionId: string) {
    this.socket?.emit('unsubscribe:claude:session', sessionId);
  }
  subscribeClaudeProject(projectId: string) {
    this.socket?.emit('subscribe:claude:project', projectId);
  }
  unsubscribeClaudeProject(projectId: string) {
    this.socket?.emit('unsubscribe:claude:project', projectId);
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export const socketService = new SocketService();
