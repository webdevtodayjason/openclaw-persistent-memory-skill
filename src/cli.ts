#!/usr/bin/env node
/**
 * OpenClaw-Mem CLI
 * Command line interface for managing the memory system
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, openSync } from 'fs';
import { join } from 'path';
import { createServer, DEFAULT_PORT } from './worker/server.js';
import { isWorkerRunning, searchMemory, getObservations } from './hooks/index.js';
import { getDatabase } from './database/index.js';

const HOME = process.env.HOME || '~';
const CONFIG_DIR = join(HOME, '.openclaw-mem');
const PID_FILE = join(CONFIG_DIR, 'worker.pid');
const LOG_FILE = join(CONFIG_DIR, 'worker.log');

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function printUsage(): void {
  console.log(`
OpenClaw-Mem - Persistent memory system for OpenClaw

USAGE:
  openclaw-mem <command> [options]

COMMANDS:
  start         Start the worker service (foreground)
  start-daemon  Start the worker service (background)
  stop          Stop the background worker service
  status        Check if the worker is running
  search        Search memory
  stats         Show memory statistics
  install       Configure OpenClaw to use openclaw-mem
  help          Show this help message

OPTIONS:
  --port <port>   Worker service port (default: ${DEFAULT_PORT})
  --db <path>     Database path (default: ~/.openclaw-mem/memory.db)

EXAMPLES:
  openclaw-mem start
  openclaw-mem search "morning briefing script"
  openclaw-mem stats
`);
}

async function startForeground(port: number): Promise<void> {
  ensureConfigDir();
  
  console.log(`Starting OpenClaw-Mem worker on port ${port}...`);
  
  const server = await createServer({ port });
  
  await server.listen({ port, host: '127.0.0.1' });
  console.log(`OpenClaw-Mem worker running on http://127.0.0.1:${port}`);
  console.log('Press Ctrl+C to stop');
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.close();
    process.exit(0);
  });
}

async function startDaemon(port: number): Promise<void> {
  ensureConfigDir();
  
  // Check if already running
  if (await isWorkerRunning()) {
    console.log('Worker is already running');
    return;
  }
  
  // Open log file for output
  const logFd = openSync(LOG_FILE, 'a');
  
  // Spawn background process with output to log file
  const child = spawn(process.execPath, [process.argv[1], 'start', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, OPENCLAW_MEM_PORT: String(port) }
  });
  
  // Write PID
  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid));
  }
  
  // Detach completely
  child.unref();
  
  // Wait for startup
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (await isWorkerRunning()) {
    console.log(`OpenClaw-Mem worker started (PID: ${child.pid})`);
    console.log(`Running on http://127.0.0.1:${port}`);
  } else {
    console.error('Failed to start worker');
    process.exit(1);
  }
}

async function stopDaemon(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log('No PID file found, worker may not be running');
    return;
  }
  
  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped worker (PID: ${pid})`);
  } catch (error) {
    console.log('Worker already stopped');
  }
  
  // Clean up PID file
  try {
    require('fs').unlinkSync(PID_FILE);
  } catch {}
}

async function showStatus(): Promise<void> {
  const running = await isWorkerRunning();
  
  if (running) {
    console.log('Status: RUNNING');
    
    // Get stats
    try {
      const db = getDatabase();
      const stats = db.getStats();
      console.log(`Sessions: ${stats.totalSessions}`);
      console.log(`Observations: ${stats.totalObservations}`);
      console.log('Types:', stats.observationsByType);
    } catch {}
  } else {
    console.log('Status: STOPPED');
  }
}

async function searchCommand(query: string): Promise<void> {
  const result = await searchMemory({ query, limit: 10 });
  
  if (!result.success) {
    console.error('Search failed:', result.error);
    console.log('Make sure the worker is running: openclaw-mem start');
    process.exit(1);
  }
  
  if (result.data!.count === 0) {
    console.log('No results found');
    return;
  }
  
  console.log(`Found ${result.data!.count} results:\n`);
  
  for (const r of result.data!.results) {
    const date = new Date(r.created_at).toLocaleDateString();
    console.log(`#${r.id} [${r.type}] ${date}`);
    console.log(`  ${r.summary || r.tool_name || 'No summary'}`);
    console.log();
  }
}

async function showStats(): Promise<void> {
  const db = getDatabase();
  const stats = db.getStats();
  
  console.log('OpenClaw-Mem Statistics\n');
  console.log(`Total Sessions: ${stats.totalSessions}`);
  console.log(`Total Observations: ${stats.totalObservations}`);
  console.log('\nObservations by Type:');
  
  for (const [type, count] of Object.entries(stats.observationsByType)) {
    console.log(`  ${type}: ${count}`);
  }
}

function installConfig(): void {
  ensureConfigDir();
  
  // Create default settings
  const settingsPath = join(CONFIG_DIR, 'settings.json');
  if (!existsSync(settingsPath)) {
    const defaultSettings = {
      port: DEFAULT_PORT,
      dataDir: CONFIG_DIR,
      database: {
        path: join(CONFIG_DIR, 'memory.db')
      },
      contextInjection: {
        enabled: true,
        maxTokens: 4000,
        includeTypes: ['decision', 'bugfix', 'architecture']
      }
    };
    writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
  }
  
  console.log('OpenClaw-Mem installed!');
  console.log(`Config directory: ${CONFIG_DIR}`);
  console.log(`Settings: ${settingsPath}`);
  console.log('\nTo start the worker:');
  console.log('  openclaw-mem start-daemon');
  console.log('\nTo configure OpenClaw, add to your config:');
  console.log(`
plugins:
  openclaw-mem:
    enabled: true
    port: ${DEFAULT_PORT}
`);
}

// ============ Main ============

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Parse options
  let port = DEFAULT_PORT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
    }
  }
  
  switch (command) {
    case 'start':
      await startForeground(port);
      break;
      
    case 'start-daemon':
      await startDaemon(port);
      break;
      
    case 'stop':
      await stopDaemon();
      break;
      
    case 'status':
      await showStatus();
      break;
      
    case 'search':
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      if (!query) {
        console.error('Usage: openclaw-mem search <query>');
        process.exit(1);
      }
      await searchCommand(query);
      break;
      
    case 'stats':
      await showStats();
      break;
      
    case 'install':
      installConfig();
      break;
      
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
