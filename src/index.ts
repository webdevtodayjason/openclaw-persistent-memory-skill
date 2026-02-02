/**
 * OpenClaw-Mem
 * Persistent memory system for OpenClaw
 */

// Database
export { 
  MemoryDatabase, 
  getDatabase, 
  closeDatabase,
  type Session,
  type Observation,
  type SearchResult
} from './database/index.js';

// Hooks
export {
  isWorkerRunning,
  waitForWorker,
  onSessionStart,
  onToolResult,
  onSessionEnd,
  searchMemory,
  getObservations,
  getTimeline
} from './hooks/index.js';

// Worker
export { createServer, DEFAULT_PORT } from './worker/server.js';

// Version
export const VERSION = '0.1.0';
