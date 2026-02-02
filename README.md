# OpenClaw-Mem

**Persistent memory system for OpenClaw** - automatically captures context across sessions, enabling semantic search and progressive disclosure of past work.

> Inspired by and adapted from [Claude-Mem](https://github.com/thedotmack/claude-mem) by Alex Newman ([@thedotmack](https://github.com/thedotmack))

---

## Why OpenClaw-Mem?

OpenClaw agents wake up fresh each session. Currently, continuity relies on:
- Manually maintained `MEMORY.md` files
- Daily logs in `memory/YYYY-MM-DD.md`
- Reading through past context files

**OpenClaw-Mem changes this:**
- 🧠 **Automatic capture** - Every tool use, decision, and observation is recorded
- 🔍 **Semantic search** - Query past work with natural language
- 📊 **Progressive disclosure** - Start with summaries, drill into details (token-efficient)
- 🔗 **Reference IDs** - Link MEMORY.md entries to specific observations
- 🖥️ **Web viewer** - Browse memory stream at http://localhost:37778

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           OpenClaw Gateway                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│   │ SessionStart │    │  ToolResult  │    │  SessionEnd  │         │
│   │    Hook      │    │    Hook      │    │    Hook      │         │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘         │
│          │                   │                   │                  │
│          └───────────────────┼───────────────────┘                  │
│                              │                                      │
│                              ▼                                      │
│                    ┌─────────────────┐                              │
│                    │  OpenClaw-Mem   │                              │
│                    │  Worker Service │                              │
│                    │  (port 37778)   │                              │
│                    └────────┬────────┘                              │
│                              │                                      │
│          ┌──────────────────┼──────────────────┐                   │
│          │                  │                  │                    │
│          ▼                  ▼                  ▼                    │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐               │
│   │   SQLite   │    │   Chroma   │    │  Web UI    │               │
│   │  Database  │    │  Vector DB │    │  Viewer    │               │
│   └────────────┘    └────────────┘    └────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **Worker Service** (`src/worker/`) - HTTP API server
   - Receives observations from hooks
   - Stores in SQLite + vector embeddings
   - Provides search endpoints
   - Serves web viewer UI

2. **Lifecycle Hooks** (`src/hooks/`) - OpenClaw integration points
   - `session-start.ts` - Inject past context, start worker
   - `tool-result.ts` - Capture tool observations
   - `session-end.ts` - Generate session summary

3. **Database** (`src/database/`) - Storage layer
   - SQLite for structured data (sessions, observations, summaries)
   - FTS5 for full-text search
   - Chroma for vector/semantic search

4. **Search** (`src/search/`) - Query engine
   - Hybrid search (keyword + semantic)
   - Progressive disclosure (index → timeline → details)
   - Token cost tracking

5. **MCP Tools** (`src/mcp/`) - Model Context Protocol integration
   - `search` - Query memory with filters
   - `timeline` - Chronological context
   - `get_observations` - Fetch full details by ID

---

## Installation

### From npm (coming soon)

```bash
npm install -g openclaw-mem
openclaw-mem install
```

### From source

```bash
git clone https://github.com/openclaw/openclaw-mem
cd openclaw-mem
npm install
npm run build
npm link
```

### Configure OpenClaw

Add to your OpenClaw config (`~/.openclaw/config.yaml`):

```yaml
plugins:
  openclaw-mem:
    enabled: true
    port: 37778
    dataDir: ~/.openclaw-mem
    contextInjection:
      enabled: true
      maxTokens: 4000
```

---

## Usage

### Automatic Operation

Once installed, OpenClaw-Mem works automatically:
- **Session starts** → Past context injected
- **Tools execute** → Observations captured
- **Session ends** → Summary generated

### Querying Memory

In any OpenClaw session, you can search past work:

```
> What did we work on with the morning briefing script?

[OpenClaw-Mem searches observations]

Found 3 relevant observations:
- #1234 (2026-02-01): Fixed PATH issue for cron compatibility
- #1235 (2026-02-01): Added weather and calendar to briefing
- #1236 (2026-02-01): Configured email delivery to iCloud

Want me to show details for any of these?
```

### MEMORY.md Integration

Your `MEMORY.md` becomes an index:

```markdown
# MEMORY.md

## Morning Briefing Script
Fixed PATH issue for cron on 2026-02-01.
See: observation #1234

## Silver Price Tracking
Heartbeat-based monitoring implemented.
See: observations #5678, #5679, #5680
```

### Web Viewer

Browse the memory stream at: **http://localhost:37778**

Features:
- Real-time observation feed
- Search interface
- Session timeline
- Export/import

---

## API Reference

### Worker Service Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/observations` | POST | Store new observation |
| `/api/observations/:id` | GET | Get observation by ID |
| `/api/search` | POST | Search observations |
| `/api/timeline` | POST | Get chronological context |
| `/api/sessions` | GET | List sessions |
| `/api/sessions/:id/summary` | GET | Get session summary |
| `/api/context` | GET | Get context for injection |

### MCP Tools

#### `search`
```typescript
search({
  query: string,           // Natural language query
  type?: string,           // Filter: observation, decision, bugfix, etc.
  since?: string,          // ISO date filter
  project?: string,        // Project filter
  limit?: number           // Max results (default: 10)
})
```

#### `timeline`
```typescript
timeline({
  observationId?: number,  // Center on this observation
  query?: string,          // Or search and show context
  range?: number           // Hours before/after (default: 2)
})
```

#### `get_observations`
```typescript
get_observations({
  ids: number[]            // Observation IDs to fetch
})
```

---

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
    "includeTypes": ["decision", "bugfix", "architecture"],
    "excludeTypes": ["routine"]
  },
  "summarization": {
    "enabled": true,
    "model": "claude-3-haiku"
  },
  "ui": {
    "enabled": true,
    "theme": "dark"
  }
}
```

---

## Development

### Prerequisites

- Node.js 18+
- Bun (optional, for faster execution)
- OpenClaw installed

### Setup

```bash
git clone https://github.com/openclaw/openclaw-mem
cd openclaw-mem
npm install
npm run dev
```

### Testing

```bash
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
```

### Building

```bash
npm run build           # Compile TypeScript
npm run build:ui        # Build web viewer
npm run package         # Create distributable
```

---

## Roadmap

### v0.1.0 (MVP)
- [x] Project structure
- [ ] Worker service with SQLite
- [ ] Basic hooks (session-start, tool-result, session-end)
- [ ] Simple search (FTS5)
- [ ] Context injection

### v0.2.0
- [ ] Vector search (Chroma integration)
- [ ] Progressive disclosure
- [ ] Web viewer UI
- [ ] MCP tools

### v0.3.0
- [ ] Session summaries with AI
- [ ] MEMORY.md auto-linking
- [ ] Import/export
- [ ] Multi-project support

### v1.0.0
- [ ] Full OpenClaw plugin integration
- [ ] Marketplace listing
- [ ] Documentation site
- [ ] Community contributions

---

## Credits

This project is adapted from [Claude-Mem](https://github.com/thedotmack/claude-mem) by Alex Newman ([@thedotmack](https://github.com/thedotmack)).

Claude-Mem is licensed under AGPL-3.0. This adaptation maintains compatibility with that license while adding OpenClaw-specific integrations.

---

## License

**GNU Affero General Public License v3.0** (AGPL-3.0)

See [LICENSE](LICENSE) for details.

---

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a Pull Request

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

---

## Links

- **OpenClaw**: https://github.com/openclaw/openclaw
- **Documentation**: https://docs.openclaw.ai/plugins/openclaw-mem
- **Discord**: https://discord.com/invite/clawd
- **Original Claude-Mem**: https://github.com/thedotmack/claude-mem
