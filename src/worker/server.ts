/**
 * OpenClaw-Mem Worker Service
 * HTTP API server for memory operations
 */

import Fastify, { FastifyInstance } from 'fastify';
import { getDatabase, closeDatabase, MemoryDatabase } from '../database/index.js';
import { join } from 'path';

const DEFAULT_PORT = 37778;

interface WorkerConfig {
  port?: number;
  dbPath?: string;
  uiPath?: string;
}

export async function createServer(config: WorkerConfig = {}): Promise<FastifyInstance> {
  const port = config.port || DEFAULT_PORT;
  const db = getDatabase(config.dbPath);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info'
    }
  });

  // ============ Health & Status ============

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/api/stats', async () => {
    return db.getStats();
  });

  // ============ Sessions ============

  app.post<{
    Body: { session_key: string; project_path?: string }
  }>('/api/sessions', async (request) => {
    const { session_key, project_path } = request.body;
    const session = db.createSession(session_key, project_path);
    return session;
  });

  app.get<{
    Params: { key: string }
  }>('/api/sessions/:key', async (request, reply) => {
    const session = db.getSession(request.params.key);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    return session;
  });

  app.post<{
    Params: { key: string };
    Body: { summary?: string }
  }>('/api/sessions/:key/end', async (request) => {
    db.endSession(request.params.key, request.body.summary);
    return { success: true };
  });

  app.get('/api/sessions', async () => {
    return db.getRecentSessions(20);
  });

  // ============ Observations ============

  app.post<{
    Body: {
      session_key: string;
      type: string;
      tool_name?: string;
      input?: string;
      output?: string;
      summary?: string;
      tokens?: number;
      importance?: number;
      metadata?: Record<string, unknown>;
    }
  }>('/api/observations', async (request, reply) => {
    const { session_key, ...observationData } = request.body;
    
    // Get or create session
    let session = db.getSession(session_key);
    if (!session) {
      session = db.createSession(session_key);
    }
    
    const observation = db.createObservation({
      session_id: session.id,
      ...observationData
    });
    
    return observation;
  });

  app.get<{
    Params: { id: string }
  }>('/api/observations/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const observation = db.getObservation(id);
    if (!observation) {
      return reply.code(404).send({ error: 'Observation not found' });
    }
    return observation;
  });

  app.post<{
    Body: { ids: number[] }
  }>('/api/observations/batch', async (request) => {
    const { ids } = request.body;
    return db.getObservations(ids);
  });

  app.get('/api/observations', async () => {
    return db.getRecentObservations(50);
  });

  // ============ Search ============

  app.post<{
    Body: {
      query: string;
      type?: string;
      since?: string;
      limit?: number;
    }
  }>('/api/search', async (request) => {
    const { query, type, since, limit } = request.body;
    
    try {
      const results = db.search(query, { type, since, limit });
      return {
        query,
        results,
        count: results.length
      };
    } catch (error) {
      // FTS5 query syntax error
      return {
        query,
        results: [],
        count: 0,
        error: 'Search query syntax error'
      };
    }
  });

  // ============ Timeline ============

  app.post<{
    Body: {
      observation_id?: number;
      range_hours?: number;
    }
  }>('/api/timeline', async (request, reply) => {
    const { observation_id, range_hours } = request.body;
    
    if (!observation_id) {
      return reply.code(400).send({ error: 'observation_id required' });
    }
    
    const timeline = db.getTimeline(observation_id, range_hours || 2);
    return {
      center_id: observation_id,
      range_hours: range_hours || 2,
      observations: timeline
    };
  });

  // ============ Context Injection ============

  app.get<{
    Querystring: {
      project_path?: string;
      max_tokens?: string;
    }
  }>('/api/context', async (request) => {
    const { project_path, max_tokens } = request.query;
    
    const result = db.getContextForInjection({
      projectPath: project_path,
      maxTokens: max_tokens ? parseInt(max_tokens, 10) : undefined
    });
    
    // Format context as text for injection
    const contextLines = result.observations.map(obs => {
      const date = new Date(obs.created_at).toLocaleDateString();
      const summary = obs.summary || `${obs.type}: ${obs.tool_name || 'unknown'}`;
      return `[#${obs.id} ${date}] ${summary}`;
    });
    
    return {
      observations: result.observations,
      totalTokens: result.totalTokens,
      contextText: contextLines.join('\n')
    };
  });

  // ============ Hooks Integration ============

  // Called by OpenClaw on session start
  app.post<{
    Body: {
      session_key: string;
      project_path?: string;
    }
  }>('/api/hooks/session-start', async (request) => {
    const { session_key, project_path } = request.body;
    
    // Create session
    const session = db.createSession(session_key, project_path);
    
    // Get context for injection
    const context = db.getContextForInjection({
      projectPath: project_path,
      maxTokens: 4000
    });
    
    return {
      session,
      context: {
        observations: context.observations,
        totalTokens: context.totalTokens
      }
    };
  });

  // Called by OpenClaw after tool execution
  app.post<{
    Body: {
      session_key: string;
      tool_name: string;
      input: string;
      output: string;
      type?: string;
      importance?: number;
    }
  }>('/api/hooks/tool-result', async (request) => {
    const { session_key, tool_name, input, output, type, importance } = request.body;
    
    // Get or create session
    let session = db.getSession(session_key);
    if (!session) {
      session = db.createSession(session_key);
    }
    
    // Classify observation type
    const obsType = type || classifyObservation(tool_name, input, output);
    
    // Calculate importance
    const obsImportance = importance ?? calculateImportance(obsType, tool_name, input, output);
    
    // Create observation
    const observation = db.createObservation({
      session_id: session.id,
      type: obsType,
      tool_name,
      input: truncateForStorage(input, 5000),
      output: truncateForStorage(output, 10000),
      importance: obsImportance
    });
    
    return observation;
  });

  // Called by OpenClaw on session end
  app.post<{
    Body: {
      session_key: string;
      summary?: string;
    }
  }>('/api/hooks/session-end', async (request) => {
    const { session_key, summary } = request.body;
    
    db.endSession(session_key, summary);
    
    return { success: true };
  });

  // Graceful shutdown
  app.addHook('onClose', async () => {
    closeDatabase();
  });

  return app;
}

// ============ Helper Functions ============

function classifyObservation(toolName: string, input: string, output: string): string {
  // Classify based on tool name and content
  const lowerTool = toolName.toLowerCase();
  const lowerInput = input.toLowerCase();
  const lowerOutput = output.toLowerCase();
  
  if (lowerTool.includes('write') || lowerTool.includes('edit')) {
    if (lowerInput.includes('fix') || lowerOutput.includes('fixed')) {
      return 'bugfix';
    }
    return 'code_change';
  }
  
  if (lowerTool.includes('exec') || lowerTool === 'bash') {
    if (lowerInput.includes('git')) return 'git_operation';
    if (lowerInput.includes('npm') || lowerInput.includes('yarn')) return 'dependency';
    if (lowerInput.includes('test')) return 'testing';
    return 'command';
  }
  
  if (lowerTool.includes('read')) {
    return 'exploration';
  }
  
  if (lowerTool.includes('search')) {
    return 'research';
  }
  
  return 'tool_use';
}

function calculateImportance(type: string, toolName: string, input: string, output: string): number {
  // Base importance by type
  const typeImportance: Record<string, number> = {
    'bugfix': 0.9,
    'architecture': 0.9,
    'decision': 0.85,
    'code_change': 0.7,
    'git_operation': 0.6,
    'testing': 0.6,
    'dependency': 0.5,
    'research': 0.4,
    'exploration': 0.3,
    'command': 0.4,
    'tool_use': 0.5
  };
  
  let importance = typeImportance[type] || 0.5;
  
  // Boost for certain patterns
  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes('error') || lowerOutput.includes('failed')) {
    importance = Math.min(importance + 0.1, 1.0);
  }
  if (lowerOutput.includes('success') || lowerOutput.includes('completed')) {
    importance = Math.min(importance + 0.05, 1.0);
  }
  
  return importance;
}

function truncateForStorage(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '... [truncated]';
}

// ============ Main ============

async function main() {
  const port = parseInt(process.env.OPENCLAW_MEM_PORT || String(DEFAULT_PORT), 10);
  const dbPath = process.env.OPENCLAW_MEM_DB;
  
  const server = await createServer({ port, dbPath });
  
  try {
    await server.listen({ port, host: '127.0.0.1' });
    console.log(`OpenClaw-Mem worker running on http://127.0.0.1:${port}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await server.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await server.close();
    process.exit(0);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { DEFAULT_PORT };
