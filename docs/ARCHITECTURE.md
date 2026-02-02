# OpenClaw-Mem Architecture

## Overview

OpenClaw-Mem is a persistent memory system designed to give OpenClaw agents continuity across sessions. It captures observations automatically, stores them in a searchable database, and injects relevant context into new sessions.

## Core Principles

### 1. Automatic Capture
Agents shouldn't have to manually log memories. Every tool use, decision, and observation is automatically captured via lifecycle hooks.

### 2. Progressive Disclosure
Memory retrieval follows a token-efficient 3-layer pattern:
1. **Index** - Compact list with IDs (~50-100 tokens/result)
2. **Timeline** - Chronological context around interesting items
3. **Details** - Full content only for filtered IDs (~500-1000 tokens/result)

This approach achieves ~10x token savings compared to loading full details upfront.

### 3. Semantic + Keyword Search
Hybrid search combines:
- **FTS5 full-text search** - Fast keyword matching
- **Vector embeddings (Chroma)** - Semantic similarity

### 4. Non-Blocking Integration
All hooks are non-blocking. If the worker service is unavailable, the agent continues working without memory features.

## Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │ SessionStart │   │  ToolResult  │   │  SessionEnd  │        │
│  │    Hook      │   │    Hook      │   │    Hook      │        │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘        │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                    │
│                            ▼                                    │
│                  ┌─────────────────┐                            │
│                  │  Worker Service │                            │
│                  │  (HTTP + SQLite)│                            │
│                  └────────┬────────┘                            │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                  │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐              │
│  │   SQLite   │   │   Chroma   │   │  Web UI    │              │
│  │  + FTS5    │   │ Vector DB  │   │  Viewer    │              │
│  └────────────┘   └────────────┘   └────────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Worker Service
- Fastify HTTP server on port 37778
- Handles observation storage, search, and context injection
- Runs as a background daemon

### Database Layer
- SQLite with FTS5 for full-text search
- Stores: sessions, observations, context cache
- Vector embeddings tracked (stored in Chroma)

### Hooks
- **session-start**: Creates session, injects past context
- **tool-result**: Captures tool use observations
- **session-end**: Generates session summary

### Search Engine
- FTS5 for keyword queries
- Chroma for semantic similarity (optional)
- Filters: type, date, project, importance

## Data Model

### Session
```typescript
interface Session {
  id: number;
  session_key: string;       // Unique identifier
  project_path: string;      // Working directory
  started_at: string;        // ISO timestamp
  ended_at: string | null;   // When session ended
  summary: string | null;    // AI-generated summary
}
```

### Observation
```typescript
interface Observation {
  id: number;
  session_id: number;
  type: string;              // 'tool_use', 'decision', 'bugfix', etc.
  tool_name: string;         // e.g., 'Read', 'Write', 'exec'
  input: string;             // Tool input (truncated)
  output: string;            // Tool output (truncated)
  summary: string;           // AI-generated summary
  tokens: number;            // Token count
  importance: number;        // 0.0 to 1.0
  created_at: string;        // ISO timestamp
}
```

### Observation Types
- `tool_use` - Generic tool execution
- `decision` - Architectural or design decision
- `bugfix` - Bug fix or error resolution
- `code_change` - File modification
- `git_operation` - Git commands
- `research` - Web searches, documentation reads
- `exploration` - Reading files for context
- `routine` - Low-importance operations

## Context Injection

On session start, relevant observations are injected into the agent's context:

1. **Filter** by type (decisions, bugfixes, architecture)
2. **Sort** by importance and recency
3. **Budget** tokens (default: 4000)
4. **Format** as compact summaries with IDs

Example injected context:
```
## Recent Memory (3847 tokens)

[#1234 2026-02-01] Fixed PATH issue for cron - added explicit PATH export
[#1235 2026-02-01] Morning briefing: Added weather, calendar, silver prices
[#1240 2026-02-02] Silver price heartbeat - implemented $1 threshold alerting
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/stats` | GET | Database statistics |
| `/api/sessions` | POST | Create session |
| `/api/sessions/:key` | GET | Get session by key |
| `/api/observations` | POST | Store observation |
| `/api/observations/:id` | GET | Get observation by ID |
| `/api/observations/batch` | POST | Get multiple observations |
| `/api/search` | POST | Search observations |
| `/api/timeline` | POST | Get chronological context |
| `/api/context` | GET | Get context for injection |
| `/api/hooks/session-start` | POST | Session start hook |
| `/api/hooks/tool-result` | POST | Tool result hook |
| `/api/hooks/session-end` | POST | Session end hook |

## Configuration

Settings stored in `~/.openclaw-mem/settings.json`:

```json
{
  "port": 37778,
  "dataDir": "~/.openclaw-mem",
  "database": {
    "path": "~/.openclaw-mem/memory.db"
  },
  "vectorDb": {
    "enabled": true,
    "path": "~/.openclaw-mem/chroma"
  },
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeTypes": ["decision", "bugfix", "architecture"]
  }
}
```

## Integration with MEMORY.md

OpenClaw-Mem complements (not replaces) MEMORY.md:

- **MEMORY.md** = Curated index with observation references
- **OpenClaw-Mem** = Full automatic capture

Example MEMORY.md entry:
```markdown
## Morning Briefing Script
Fixed PATH issue for cron compatibility on 2026-02-01.
See: observation #1234

Details: The gog CLI wasn't found because cron doesn't inherit
the shell's PATH. Added explicit PATH export at script top.
```

When Jason (or the agent) needs more detail, query:
- `openclaw-mem search "morning briefing PATH"` 
- Or: "Show me observation #1234"

## Future Enhancements

### v0.2.0
- [ ] Chroma vector search integration
- [ ] AI-powered summarization
- [ ] Web viewer UI

### v0.3.0
- [ ] Auto-link MEMORY.md entries
- [ ] Multi-project isolation
- [ ] Export/import

### v1.0.0
- [ ] Full OpenClaw plugin integration
- [ ] MCP tools for model queries
- [ ] Marketplace listing
