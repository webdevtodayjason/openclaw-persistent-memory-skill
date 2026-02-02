/**
 * OpenClaw-Mem Database Module
 * SQLite storage with FTS5 full-text search
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Session {
  id: number;
  session_key: string;
  project_path: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  summary_tokens: number | null;
  metadata: Record<string, unknown> | null;
}

export interface Observation {
  id: number;
  session_id: number;
  type: string;
  tool_name: string | null;
  input: string | null;
  output: string | null;
  summary: string | null;
  tokens: number | null;
  importance: number;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface SearchResult {
  id: number;
  type: string;
  tool_name: string | null;
  summary: string | null;
  created_at: string;
  importance: number;
  rank: number;
}

export class MemoryDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    this.initialize();
  }

  private initialize(): void {
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  // ============ Sessions ============

  createSession(sessionKey: string, projectPath?: string): Session {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_key, project_path)
      VALUES (?, ?)
      RETURNING *
    `);
    const row = stmt.get(sessionKey, projectPath || null) as Session;
    return this.parseSession(row);
  }

  getSession(sessionKey: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_key = ?');
    const row = stmt.get(sessionKey) as Session | undefined;
    return row ? this.parseSession(row) : null;
  }

  getSessionById(id: number): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as Session | undefined;
    return row ? this.parseSession(row) : null;
  }

  endSession(sessionKey: string, summary?: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET ended_at = CURRENT_TIMESTAMP, summary = ?
      WHERE session_key = ?
    `);
    stmt.run(summary || null, sessionKey);
  }

  getRecentSessions(limit: number = 10): Session[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions 
      ORDER BY started_at DESC 
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Session[];
    return rows.map(row => this.parseSession(row));
  }

  private parseSession(row: Session): Session {
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata as unknown as string) : null
    };
  }

  // ============ Observations ============

  createObservation(observation: {
    session_id: number;
    type: string;
    tool_name?: string;
    input?: string;
    output?: string;
    summary?: string;
    tokens?: number;
    importance?: number;
    metadata?: Record<string, unknown>;
  }): Observation {
    const stmt = this.db.prepare(`
      INSERT INTO observations 
        (session_id, type, tool_name, input, output, summary, tokens, importance, metadata)
      VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    const row = stmt.get(
      observation.session_id,
      observation.type,
      observation.tool_name || null,
      observation.input || null,
      observation.output || null,
      observation.summary || null,
      observation.tokens || null,
      observation.importance ?? 0.5,
      observation.metadata ? JSON.stringify(observation.metadata) : null
    ) as Observation;
    return this.parseObservation(row);
  }

  getObservation(id: number): Observation | null {
    const stmt = this.db.prepare('SELECT * FROM observations WHERE id = ?');
    const row = stmt.get(id) as Observation | undefined;
    return row ? this.parseObservation(row) : null;
  }

  getObservations(ids: number[]): Observation[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM observations 
      WHERE id IN (${placeholders})
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(...ids) as Observation[];
    return rows.map(row => this.parseObservation(row));
  }

  getSessionObservations(sessionId: number): Observation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM observations 
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(sessionId) as Observation[];
    return rows.map(row => this.parseObservation(row));
  }

  getRecentObservations(limit: number = 50): Observation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM observations 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Observation[];
    return rows.map(row => this.parseObservation(row));
  }

  private parseObservation(row: Observation): Observation {
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata as unknown as string) : null
    };
  }

  // ============ Search ============

  search(query: string, options: {
    type?: string;
    since?: string;
    limit?: number;
  } = {}): SearchResult[] {
    const limit = options.limit || 10;
    
    let sql = `
      SELECT 
        o.id,
        o.type,
        o.tool_name,
        o.summary,
        o.created_at,
        o.importance,
        bm25(observations_fts) as rank
      FROM observations_fts
      JOIN observations o ON observations_fts.rowid = o.id
      WHERE observations_fts MATCH ?
    `;
    
    const params: (string | number)[] = [query];
    
    if (options.type) {
      sql += ' AND o.type = ?';
      params.push(options.type);
    }
    
    if (options.since) {
      sql += ' AND o.created_at >= ?';
      params.push(options.since);
    }
    
    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);
    
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as SearchResult[];
  }

  // ============ Timeline ============

  getTimeline(observationId: number, rangeHours: number = 2): Observation[] {
    const observation = this.getObservation(observationId);
    if (!observation) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM observations
      WHERE created_at BETWEEN 
        datetime(?, '-${rangeHours} hours') AND 
        datetime(?, '+${rangeHours} hours')
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(observation.created_at, observation.created_at) as Observation[];
    return rows.map(row => this.parseObservation(row));
  }

  // ============ Context ============

  getContextForInjection(options: {
    projectPath?: string;
    maxTokens?: number;
    includeTypes?: string[];
  } = {}): { observations: Observation[]; totalTokens: number } {
    const maxTokens = options.maxTokens || 4000;
    const includeTypes = options.includeTypes || ['decision', 'bugfix', 'architecture'];
    
    const typePlaceholders = includeTypes.map(() => '?').join(',');
    
    let sql = `
      SELECT * FROM observations
      WHERE type IN (${typePlaceholders})
      AND importance >= 0.5
    `;
    
    const params: (string | number)[] = [...includeTypes];
    
    if (options.projectPath) {
      sql += `
        AND session_id IN (
          SELECT id FROM sessions WHERE project_path = ?
        )
      `;
      params.push(options.projectPath);
    }
    
    sql += ' ORDER BY importance DESC, created_at DESC LIMIT 100';
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Observation[];
    
    // Filter by token budget
    const observations: Observation[] = [];
    let totalTokens = 0;
    
    for (const row of rows) {
      const obs = this.parseObservation(row);
      const obsTokens = obs.tokens || 100; // Estimate if not stored
      
      if (totalTokens + obsTokens <= maxTokens) {
        observations.push(obs);
        totalTokens += obsTokens;
      } else {
        break;
      }
    }
    
    return { observations, totalTokens };
  }

  // ============ Stats ============

  getStats(): {
    totalSessions: number;
    totalObservations: number;
    observationsByType: Record<string, number>;
  } {
    const sessions = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const observations = this.db.prepare('SELECT COUNT(*) as count FROM observations').get() as { count: number };
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM observations 
      GROUP BY type
    `).all() as { type: string; count: number }[];
    
    return {
      totalSessions: sessions.count,
      totalObservations: observations.count,
      observationsByType: Object.fromEntries(byType.map(r => [r.type, r.count]))
    };
  }

  // ============ Cleanup ============

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let instance: MemoryDatabase | null = null;

export function getDatabase(dbPath?: string): MemoryDatabase {
  if (!instance) {
    const path = dbPath || join(process.env.HOME || '~', '.openclaw-mem', 'memory.db');
    instance = new MemoryDatabase(path);
  }
  return instance;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
