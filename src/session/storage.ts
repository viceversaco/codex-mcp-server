import { randomUUID } from 'crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { TOOLS } from '../types.js';
import { ValidationError } from '../errors.js';

const warn = (msg: string, cause?: unknown): void => {
  if (cause !== undefined) {
    console.error(`[codex-mcp-server] ${msg}`, cause);
  } else {
    console.error(`[codex-mcp-server] ${msg}`);
  }
};

export interface ConversationTurn {
  prompt: string;
  response: string;
  timestamp: Date;
}

export interface SessionData {
  id: string;
  createdAt: Date;
  lastAccessedAt: Date;
  turns: ConversationTurn[];
  codexConversationId?: string;
}

export interface SessionStorage {
  createSession(): string;
  ensureSession(sessionId: string): void;
  getSession(sessionId: string): SessionData | undefined;
  updateSession(sessionId: string, data: Partial<SessionData>): void;
  deleteSession(sessionId: string): boolean;
  listSessions(): SessionData[];
  addTurn(sessionId: string, turn: ConversationTurn): void;
  resetSession(sessionId: string): void;
  setCodexConversationId(sessionId: string, conversationId: string): void;
  getCodexConversationId(sessionId: string): string | undefined;
}

export class InMemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, SessionData>();
  private readonly maxSessions = 100;
  private readonly sessionTtl = 24 * 60 * 60 * 1000; // 24 hours
  private readonly maxSessionIdLength = 256;
  private readonly sessionIdPattern = /^[a-zA-Z0-9_-]+$/;

  createSession(): string {
    this.cleanupExpiredSessions();

    const sessionId = randomUUID();
    const now = new Date();

    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: now,
      lastAccessedAt: now,
      turns: [],
    });

    this.enforceMaxSessions();
    return sessionId;
  }

  ensureSession(sessionId: string): void {
    this.cleanupExpiredSessions();

    if (
      !sessionId ||
      sessionId.length > this.maxSessionIdLength ||
      !this.sessionIdPattern.test(sessionId)
    ) {
      throw new ValidationError(
        TOOLS.CODEX,
        'Session ID must be 1-256 characters and contain only letters, numbers, hyphens, and underscores'
      );
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = new Date();
      return;
    }

    const now = new Date();
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: now,
      lastAccessedAt: now,
      turns: [],
    });

    this.enforceMaxSessions();
  }

  getSession(sessionId: string): SessionData | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = new Date();
    }
    return session;
  }

  updateSession(sessionId: string, data: Partial<SessionData>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, data);
      session.lastAccessedAt = new Date();
    }
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  listSessions(): SessionData[] {
    this.cleanupExpiredSessions();
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime()
    );
  }

  addTurn(sessionId: string, turn: ConversationTurn): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Ensure turns array exists and is valid
      if (!Array.isArray(session.turns)) {
        session.turns = [];
      }
      session.turns.push(turn);
      session.lastAccessedAt = new Date();
    }
  }

  resetSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.turns = [];
      session.codexConversationId = undefined;
      session.lastAccessedAt = new Date();
    }
  }

  setCodexConversationId(sessionId: string, conversationId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.codexConversationId = conversationId;
      session.lastAccessedAt = new Date();
    }
  }

  getCodexConversationId(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.codexConversationId;
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastAccessedAt.getTime() > this.sessionTtl) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private enforceMaxSessions(): void {
    if (this.sessions.size <= this.maxSessions) return;

    const sessions = this.listSessions();
    const sessionsToDelete = sessions.slice(this.maxSessions);

    for (const session of sessionsToDelete) {
      this.sessions.delete(session.id);
    }
  }
}

export interface FileSessionStorageOptions {
  storageDir?: string;
  sessionTtlMs?: number;
  maxSessions?: number;
}

/**
 * Disk-backed session storage. Sessions persist across MCP server restarts
 * as one JSON file per session under storageDir (default: ~/.codex-mcp/sessions).
 * Mutations are write-through; reads use the in-memory cache hydrated at construction.
 */
export class FileSessionStorage implements SessionStorage {
  private sessions = new Map<string, SessionData>();
  private readonly maxSessions: number;
  private readonly sessionTtl: number;
  private readonly maxSessionIdLength = 256;
  private readonly sessionIdPattern = /^[a-zA-Z0-9_-]+$/;
  private readonly storageDir: string;

  constructor(opts: FileSessionStorageOptions = {}) {
    this.storageDir =
      opts.storageDir ?? path.join(os.homedir(), '.codex-mcp', 'sessions');
    this.sessionTtl = opts.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days
    this.maxSessions = opts.maxSessions ?? 1000;

    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
    } catch (e) {
      warn(`Failed to create session storage dir ${this.storageDir}:`, e);
    }

    this.loadAllSessions();
  }

  private sessionFile(sessionId: string): string {
    return path.join(this.storageDir, `${sessionId}.json`);
  }

  private loadAllSessions(): void {
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(this.storageDir)
        .filter((f) => f.endsWith('.json'));
    } catch (e) {
      warn(`Failed to read session dir ${this.storageDir}:`, e);
      return;
    }

    for (const file of files) {
      const fullPath = path.join(this.storageDir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw) as SessionData & {
          createdAt: string | Date;
          lastAccessedAt: string | Date;
          turns?: Array<ConversationTurn & { timestamp: string | Date }>;
        };
        const session: SessionData = {
          id: parsed.id,
          createdAt: new Date(parsed.createdAt),
          lastAccessedAt: new Date(parsed.lastAccessedAt),
          turns: Array.isArray(parsed.turns)
            ? parsed.turns.map((t) => ({
                prompt: t.prompt,
                response: t.response,
                timestamp: new Date(t.timestamp),
              }))
            : [],
          codexConversationId: parsed.codexConversationId,
        };
        this.sessions.set(session.id, session);
      } catch (e) {
        warn(`Failed to load session file ${file}:`, e);
      }
    }

    this.cleanupExpiredSessions();
  }

  private persist(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      fs.writeFileSync(
        this.sessionFile(sessionId),
        JSON.stringify(session, null, 2),
        'utf8'
      );
    } catch (e) {
      warn(`Failed to persist session ${sessionId}:`, e);
    }
  }

  private removeFile(sessionId: string): void {
    try {
      fs.unlinkSync(this.sessionFile(sessionId));
    } catch {
      // ignore — file may not exist
    }
  }

  createSession(): string {
    this.cleanupExpiredSessions();

    const sessionId = randomUUID();
    const now = new Date();

    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: now,
      lastAccessedAt: now,
      turns: [],
    });

    this.enforceMaxSessions();
    this.persist(sessionId);
    return sessionId;
  }

  ensureSession(sessionId: string): void {
    this.cleanupExpiredSessions();

    if (
      !sessionId ||
      sessionId.length > this.maxSessionIdLength ||
      !this.sessionIdPattern.test(sessionId)
    ) {
      throw new ValidationError(
        TOOLS.CODEX,
        'Session ID must be 1-256 characters and contain only letters, numbers, hyphens, and underscores'
      );
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = new Date();
      this.persist(sessionId);
      return;
    }

    const now = new Date();
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: now,
      lastAccessedAt: now,
      turns: [],
    });

    this.enforceMaxSessions();
    this.persist(sessionId);
  }

  getSession(sessionId: string): SessionData | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = new Date();
      this.persist(sessionId);
    }
    return session;
  }

  updateSession(sessionId: string, data: Partial<SessionData>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, data);
      session.lastAccessedAt = new Date();
      this.persist(sessionId);
    }
  }

  deleteSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    if (existed) {
      this.removeFile(sessionId);
    }
    return existed;
  }

  listSessions(): SessionData[] {
    this.cleanupExpiredSessions();
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime()
    );
  }

  addTurn(sessionId: string, turn: ConversationTurn): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (!Array.isArray(session.turns)) {
        session.turns = [];
      }
      session.turns.push(turn);
      session.lastAccessedAt = new Date();
      this.persist(sessionId);
    }
  }

  resetSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.turns = [];
      session.codexConversationId = undefined;
      session.lastAccessedAt = new Date();
      this.persist(sessionId);
    }
  }

  setCodexConversationId(sessionId: string, conversationId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.codexConversationId = conversationId;
      session.lastAccessedAt = new Date();
      this.persist(sessionId);
    }
  }

  getCodexConversationId(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.codexConversationId;
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastAccessedAt.getTime() > this.sessionTtl) {
        this.sessions.delete(sessionId);
        this.removeFile(sessionId);
      }
    }
  }

  private enforceMaxSessions(): void {
    if (this.sessions.size <= this.maxSessions) return;

    const sessions = Array.from(this.sessions.values()).sort(
      (a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime()
    );
    const sessionsToDelete = sessions.slice(this.maxSessions);

    for (const session of sessionsToDelete) {
      this.sessions.delete(session.id);
      this.removeFile(session.id);
    }
  }
}
