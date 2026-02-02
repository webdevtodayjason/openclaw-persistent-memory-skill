/**
 * OpenClaw-Mem Hooks
 * Integration points for OpenClaw lifecycle events
 */

import { DEFAULT_PORT } from '../worker/server.js';

const WORKER_URL = `http://127.0.0.1:${process.env.OPENCLAW_MEM_PORT || DEFAULT_PORT}`;

interface HookResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Check if the worker service is running
 */
export async function isWorkerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKER_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for worker to be ready
 */
export async function waitForWorker(maxAttempts: number = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isWorkerRunning()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Session Start Hook
 * Called when a new OpenClaw session begins
 */
export async function onSessionStart(options: {
  sessionKey: string;
  projectPath?: string;
}): Promise<HookResponse<{
  sessionId: number;
  contextText: string;
  totalTokens: number;
}>> {
  try {
    // Ensure worker is running
    if (!await isWorkerRunning()) {
      console.warn('OpenClaw-Mem worker not running, skipping session start hook');
      return { success: false, error: 'Worker not running' };
    }

    // Create session and get context
    const response = await fetch(`${WORKER_URL}/api/hooks/session-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_key: options.sessionKey,
        project_path: options.projectPath
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as {
      session: { id: number };
      context: {
        observations: Array<{
          id: number;
          created_at: string;
          summary: string;
          type: string;
          tool_name: string;
        }>;
        totalTokens: number;
      };
    };

    // Format context for injection
    const contextLines = data.context.observations.map(obs => {
      const date = new Date(obs.created_at).toLocaleDateString();
      const summary = obs.summary || `${obs.type}: ${obs.tool_name || 'unknown'}`;
      return `[#${obs.id} ${date}] ${summary}`;
    });

    return {
      success: true,
      data: {
        sessionId: data.session.id,
        contextText: contextLines.length > 0 
          ? `## Recent Memory (${data.context.totalTokens} tokens)\n\n${contextLines.join('\n')}`
          : '',
        totalTokens: data.context.totalTokens
      }
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Tool Result Hook
 * Called after each tool execution in OpenClaw
 */
export async function onToolResult(options: {
  sessionKey: string;
  toolName: string;
  input: string;
  output: string;
  type?: string;
  importance?: number;
}): Promise<HookResponse<{ observationId: number }>> {
  try {
    // Skip if worker not running (non-blocking)
    if (!await isWorkerRunning()) {
      return { success: false, error: 'Worker not running' };
    }

    const response = await fetch(`${WORKER_URL}/api/hooks/tool-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_key: options.sessionKey,
        tool_name: options.toolName,
        input: options.input,
        output: options.output,
        type: options.type,
        importance: options.importance
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { id: number };

    return {
      success: true,
      data: { observationId: data.id }
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Session End Hook
 * Called when an OpenClaw session ends
 */
export async function onSessionEnd(options: {
  sessionKey: string;
  summary?: string;
}): Promise<HookResponse> {
  try {
    if (!await isWorkerRunning()) {
      return { success: false, error: 'Worker not running' };
    }

    const response = await fetch(`${WORKER_URL}/api/hooks/session-end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_key: options.sessionKey,
        summary: options.summary
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Search Memory
 * Query past observations with natural language
 */
export async function searchMemory(options: {
  query: string;
  type?: string;
  since?: string;
  limit?: number;
}): Promise<HookResponse<{
  results: Array<{
    id: number;
    type: string;
    tool_name: string | null;
    summary: string | null;
    created_at: string;
    importance: number;
    rank: number;
  }>;
  count: number;
}>> {
  try {
    if (!await isWorkerRunning()) {
      return { success: false, error: 'Worker not running' };
    }

    const response = await fetch(`${WORKER_URL}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as {
      results: Array<{
        id: number;
        type: string;
        tool_name: string | null;
        summary: string | null;
        created_at: string;
        importance: number;
        rank: number;
      }>;
      count: number;
    };

    return { success: true, data };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get Observations by ID
 * Fetch full details for specific observations
 */
export async function getObservations(ids: number[]): Promise<HookResponse<{
  observations: Array<{
    id: number;
    session_id: number;
    type: string;
    tool_name: string | null;
    input: string | null;
    output: string | null;
    summary: string | null;
    created_at: string;
    importance: number;
  }>;
}>> {
  try {
    if (!await isWorkerRunning()) {
      return { success: false, error: 'Worker not running' };
    }

    const response = await fetch(`${WORKER_URL}/api/observations/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const observations = await response.json();

    return { success: true, data: { observations } };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get Timeline
 * Get chronological context around an observation
 */
export async function getTimeline(options: {
  observationId: number;
  rangeHours?: number;
}): Promise<HookResponse<{
  observations: Array<{
    id: number;
    type: string;
    tool_name: string | null;
    summary: string | null;
    created_at: string;
  }>;
}>> {
  try {
    if (!await isWorkerRunning()) {
      return { success: false, error: 'Worker not running' };
    }

    const response = await fetch(`${WORKER_URL}/api/timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observation_id: options.observationId,
        range_hours: options.rangeHours || 2
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { observations: Array<{
      id: number;
      type: string;
      tool_name: string | null;
      summary: string | null;
      created_at: string;
    }> };

    return { success: true, data: { observations: data.observations } };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
