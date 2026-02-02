-- OpenClaw-Mem Database Schema
-- SQLite with FTS5 for full-text search

-- Sessions table: tracks each OpenClaw session
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT UNIQUE NOT NULL,
    project_path TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    summary TEXT,
    summary_tokens INTEGER,
    metadata JSON
);

-- Observations table: captures tool uses, decisions, and context
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    type TEXT NOT NULL,  -- 'tool_use', 'decision', 'bugfix', 'architecture', 'routine', etc.
    tool_name TEXT,
    input TEXT,
    output TEXT,
    summary TEXT,
    tokens INTEGER,
    importance REAL DEFAULT 0.5,  -- 0.0 to 1.0
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Full-text search index for observations
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    type,
    tool_name,
    input,
    output,
    summary,
    content='observations',
    content_rowid='id'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, type, tool_name, input, output, summary)
    VALUES (new.id, new.type, new.tool_name, new.input, new.output, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, type, tool_name, input, output, summary)
    VALUES ('delete', old.id, old.type, old.tool_name, old.input, old.output, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, type, tool_name, input, output, summary)
    VALUES ('delete', old.id, old.type, old.tool_name, old.input, old.output, old.summary);
    INSERT INTO observations_fts(rowid, type, tool_name, input, output, summary)
    VALUES (new.id, new.type, new.tool_name, new.input, new.output, new.summary);
END;

-- Context cache: pre-computed context for injection
CREATE TABLE IF NOT EXISTS context_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path TEXT,
    context_type TEXT NOT NULL,  -- 'recent', 'important', 'project_specific'
    content TEXT NOT NULL,
    tokens INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
);

-- Vector embeddings reference (actual vectors stored in Chroma)
CREATE TABLE IF NOT EXISTS embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER NOT NULL,
    chroma_id TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (observation_id) REFERENCES observations(id)
);

-- Settings table for configuration
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at);
CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_context_cache_project ON context_cache(project_path);
CREATE INDEX IF NOT EXISTS idx_embeddings_observation ON embeddings(observation_id);
