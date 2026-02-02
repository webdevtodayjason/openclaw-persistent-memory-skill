/**
 * OpenClaw-Mem Extension
 * 
 * Persistent memory system with automatic capture and recall.
 * Uses SQLite + FTS5 for storage and search.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Config Schema
// ============================================================================

const configSchema = Type.Object({
  workerUrl: Type.Optional(Type.String({ default: "http://127.0.0.1:37778" })),
  autoCapture: Type.Optional(Type.Boolean({ default: true })),
  autoRecall: Type.Optional(Type.Boolean({ default: true })),
  maxContextTokens: Type.Optional(Type.Number({ default: 4000 })),
  captureTypes: Type.Optional(Type.Array(Type.String(), { 
    default: ["bugfix", "decision", "architecture", "code_change"] 
  })),
});

type PluginConfig = {
  workerUrl: string;
  autoCapture: boolean;
  autoRecall: boolean;
  maxContextTokens: number;
  captureTypes: string[];
};

// ============================================================================
// Worker Client
// ============================================================================

class MemoryWorkerClient {
  constructor(private baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createSession(sessionKey: string, projectPath?: string): Promise<{ id: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/hooks/session-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_key: sessionKey, project_path: projectPath }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { id: data.session?.id };
    } catch {
      return null;
    }
  }

  async storeObservation(params: {
    sessionKey: string;
    type: string;
    toolName?: string;
    input?: string;
    output?: string;
    summary?: string;
    importance?: number;
  }): Promise<{ id: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/observations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_key: params.sessionKey,
          type: params.type,
          tool_name: params.toolName,
          input: params.input,
          output: params.output,
          summary: params.summary,
          importance: params.importance,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { id: data.id };
    } catch {
      return null;
    }
  }

  async search(query: string, options?: { type?: string; limit?: number }): Promise<Array<{
    id: number;
    type: string;
    tool_name: string | null;
    summary: string | null;
    created_at: string;
    importance: number;
  }>> {
    try {
      const res = await fetch(`${this.baseUrl}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, ...options }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch {
      return [];
    }
  }

  async getObservation(id: number): Promise<{
    id: number;
    type: string;
    tool_name: string | null;
    input: string | null;
    output: string | null;
    summary: string | null;
    created_at: string;
    importance: number;
  } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/observations/${id}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async getObservations(ids: number[]): Promise<Array<{
    id: number;
    type: string;
    tool_name: string | null;
    input: string | null;
    output: string | null;
    summary: string | null;
    created_at: string;
  }>> {
    try {
      const res = await fetch(`${this.baseUrl}/api/observations/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  async getContext(options?: { maxTokens?: number; projectPath?: string }): Promise<{
    contextText: string;
    totalTokens: number;
    observations: Array<{ id: number; summary: string }>;
  } | null> {
    try {
      const params = new URLSearchParams();
      if (options?.maxTokens) params.set("max_tokens", String(options.maxTokens));
      if (options?.projectPath) params.set("project_path", options.projectPath);
      
      const res = await fetch(`${this.baseUrl}/api/context?${params}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async endSession(sessionKey: string, summary?: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/hooks/session-end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_key: sessionKey, summary }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Observation Classification
// ============================================================================

function classifyToolResult(toolName: string, input: string, output: string): {
  type: string;
  importance: number;
} {
  const lowerTool = toolName.toLowerCase();
  const lowerInput = (input || "").toLowerCase();
  const lowerOutput = (output || "").toLowerCase();

  // Bugfixes
  if (lowerInput.includes("fix") || lowerOutput.includes("fixed") || 
      lowerOutput.includes("resolved") || lowerOutput.includes("error")) {
    return { type: "bugfix", importance: 0.9 };
  }

  // Code changes
  if (lowerTool.includes("write") || lowerTool.includes("edit")) {
    return { type: "code_change", importance: 0.7 };
  }

  // Git operations
  if (lowerTool.includes("exec") && lowerInput.includes("git")) {
    return { type: "git_operation", importance: 0.6 };
  }

  // Testing
  if (lowerInput.includes("test") || lowerOutput.includes("passed") || 
      lowerOutput.includes("failed")) {
    return { type: "testing", importance: 0.6 };
  }

  // Research/exploration
  if (lowerTool.includes("search") || lowerTool.includes("web_")) {
    return { type: "research", importance: 0.4 };
  }

  if (lowerTool.includes("read")) {
    return { type: "exploration", importance: 0.3 };
  }

  // Default
  return { type: "tool_use", importance: 0.5 };
}

function truncate(text: string | undefined | null, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + "...";
}

// ============================================================================
// Plugin Definition
// ============================================================================

const openclawMemPlugin = {
  id: "openclaw-mem",
  name: "OpenClaw-Mem",
  description: "Persistent memory system with automatic capture and semantic search",
  kind: "memory" as const,
  configSchema,

  register(api: OpenClawPluginApi) {
    const cfg = api.pluginConfig as PluginConfig;
    const workerUrl = cfg.workerUrl || "http://127.0.0.1:37778";
    const client = new MemoryWorkerClient(workerUrl);

    // Track current session
    let currentSessionKey: string | null = null;
    let workerAvailable = false;

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description: "Search through past observations and work history. Use to find context about previous work, decisions, or bugs fixed.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query (natural language)" }),
          type: Type.Optional(Type.String({ description: "Filter by type: bugfix, decision, architecture, code_change" })),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
        }),
        async execute(_toolCallId, params) {
          const { query, type, limit = 10 } = params as { query: string; type?: string; limit?: number };

          const results = await client.search(query, { type, limit });

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No matching observations found." }],
              details: { count: 0 },
            };
          }

          const text = results
            .map((r) => {
              const date = new Date(r.created_at).toLocaleDateString();
              return `#${r.id} [${r.type}] ${date}\n  ${r.summary || r.tool_name || "No summary"}`;
            })
            .join("\n\n");

          return {
            content: [{ type: "text", text: `Found ${results.length} observations:\n\n${text}` }],
            details: { count: results.length, results },
          };
        },
      },
      { name: "memory_search" },
    );

    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description: "Get full details of specific observations by ID. Use after memory_search to get complete context.",
        parameters: Type.Object({
          ids: Type.Array(Type.Number(), { description: "Observation IDs to fetch" }),
        }),
        async execute(_toolCallId, params) {
          const { ids } = params as { ids: number[] };

          const observations = await client.getObservations(ids);

          if (observations.length === 0) {
            return {
              content: [{ type: "text", text: "No observations found for the given IDs." }],
              details: { count: 0 },
            };
          }

          const text = observations
            .map((o) => {
              return `# Observation #${o.id} [${o.type}]
Date: ${o.created_at}
Tool: ${o.tool_name || "N/A"}

## Input
${truncate(o.input, 500) || "N/A"}

## Output
${truncate(o.output, 1000) || "N/A"}

## Summary
${o.summary || "N/A"}`;
            })
            .join("\n\n---\n\n");

          return {
            content: [{ type: "text", text }],
            details: { count: observations.length, observations },
          };
        },
      },
      { name: "memory_get" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description: "Manually store an important observation or decision. Use for significant decisions, architecture choices, or lessons learned.",
        parameters: Type.Object({
          summary: Type.String({ description: "Summary of what to remember" }),
          type: Type.Optional(Type.String({ description: "Type: decision, architecture, bugfix, note" })),
          importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default: 0.8)" })),
        }),
        async execute(_toolCallId, params) {
          const { summary, type = "decision", importance = 0.8 } = params as { 
            summary: string; 
            type?: string; 
            importance?: number;
          };

          const result = await client.storeObservation({
            sessionKey: currentSessionKey || "manual",
            type,
            toolName: "memory_store",
            input: summary,
            output: "Manually stored",
            summary,
            importance,
          });

          if (!result) {
            return {
              content: [{ type: "text", text: "Failed to store observation. Is the worker running?" }],
              details: { success: false },
            };
          }

          return {
            content: [{ type: "text", text: `Stored as observation #${result.id}: "${truncate(summary, 100)}"` }],
            details: { success: true, id: result.id },
          };
        },
      },
      { name: "memory_store" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const mem = program.command("mem").description("OpenClaw-Mem commands");

        mem
          .command("status")
          .description("Check worker status")
          .action(async () => {
            const healthy = await client.health();
            console.log(healthy ? "✓ Worker running" : "✗ Worker not running");
            if (!healthy) {
              console.log("Start with: openclaw-mem start-daemon");
            }
          });

        mem
          .command("search")
          .description("Search observations")
          .argument("<query>", "Search query")
          .option("--type <type>", "Filter by type")
          .option("--limit <n>", "Max results", "10")
          .action(async (query, opts) => {
            const results = await client.search(query, { 
              type: opts.type, 
              limit: parseInt(opts.limit) 
            });
            
            if (results.length === 0) {
              console.log("No results found");
              return;
            }

            for (const r of results) {
              const date = new Date(r.created_at).toLocaleDateString();
              console.log(`#${r.id} [${r.type}] ${date}`);
              console.log(`  ${r.summary || r.tool_name || "No summary"}\n`);
            }
          });

        mem
          .command("get")
          .description("Get observation details")
          .argument("<id>", "Observation ID")
          .action(async (id) => {
            const obs = await client.getObservation(parseInt(id));
            if (!obs) {
              console.log("Observation not found");
              return;
            }
            console.log(JSON.stringify(obs, null, 2));
          });
      },
      { commands: ["mem"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject context before agent starts
    if (cfg.autoRecall !== false) {
      api.on("before_agent_start", async (event) => {
        // Check worker availability
        workerAvailable = await client.health();
        if (!workerAvailable) {
          api.logger.debug?.("openclaw-mem: worker not available, skipping recall");
          return;
        }

        // Create/update session
        currentSessionKey = event.sessionKey || `session-${Date.now()}`;
        await client.createSession(currentSessionKey, event.workspaceDir);

        // Skip if no prompt
        if (!event.prompt || event.prompt.length < 10) return;

        try {
          const context = await client.getContext({ 
            maxTokens: cfg.maxContextTokens || 4000,
            projectPath: event.workspaceDir,
          });

          if (!context || !context.contextText || context.observations.length === 0) {
            return;
          }

          api.logger.info?.(`openclaw-mem: injecting ${context.observations.length} observations (${context.totalTokens} tokens)`);

          return {
            prependContext: `<memory-context>
## Recent Memory (${context.totalTokens} tokens)
The following observations are from previous sessions:

${context.contextText}

Use memory_search for more context. Reference observations by #ID.
</memory-context>`,
          };
        } catch (err) {
          api.logger.warn?.(`openclaw-mem: recall failed: ${String(err)}`);
        }
      });
    }

    // Auto-capture: store observations after agent runs
    if (cfg.autoCapture !== false) {
      api.on("agent_end", async (event) => {
        if (!workerAvailable || !currentSessionKey) return;
        if (!event.success) return;

        try {
          // Extract tool results from messages
          const toolResults: Array<{ toolName: string; input: string; output: string }> = [];
          
          for (const msg of event.messages || []) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            
            // Look for tool_result messages
            if (msgObj.role === "user" && Array.isArray(msgObj.content)) {
              for (const block of msgObj.content) {
                if (block && typeof block === "object" && 
                    (block as Record<string, unknown>).type === "tool_result") {
                  const toolBlock = block as Record<string, unknown>;
                  toolResults.push({
                    toolName: String(toolBlock.tool_use_id || "unknown"),
                    input: "", // Input is in previous assistant message
                    output: String(toolBlock.content || ""),
                  });
                }
              }
            }
          }

          // Store important observations
          let stored = 0;
          for (const result of toolResults.slice(0, 10)) {
            const classification = classifyToolResult(result.toolName, result.input, result.output);
            
            // Skip low-importance observations
            if (classification.importance < 0.5) continue;

            await client.storeObservation({
              sessionKey: currentSessionKey,
              type: classification.type,
              toolName: result.toolName,
              input: truncate(result.input, 2000),
              output: truncate(result.output, 5000),
              importance: classification.importance,
            });
            stored++;
          }

          if (stored > 0) {
            api.logger.info?.(`openclaw-mem: captured ${stored} observations`);
          }
        } catch (err) {
          api.logger.warn?.(`openclaw-mem: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "openclaw-mem",
      start: async () => {
        workerAvailable = await client.health();
        api.logger.info?.(
          `openclaw-mem: initialized (worker: ${workerAvailable ? "available" : "unavailable"})`,
        );
        if (!workerAvailable) {
          api.logger.warn?.("openclaw-mem: start worker with: openclaw-mem start-daemon");
        }
      },
      stop: () => {
        if (currentSessionKey) {
          void client.endSession(currentSessionKey);
        }
        api.logger.info?.("openclaw-mem: stopped");
      },
    });
  },
};

export default openclawMemPlugin;
