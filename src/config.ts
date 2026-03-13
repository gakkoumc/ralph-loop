import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RunMode } from './shared/types.ts';

export interface AppConfig {
  rootDir: string;
  promptFile: string;
  taskCatalogFile: string;
  stateDir: string;
  logDir: string;
  agentCommand: string;
  mode: RunMode;
  maxIterations: number;
  idleSeconds: number;
  panelPort: number;
  panelHost: string;
  taskName: string;
  discordToken: string;
  discordNotifyChannelId: string;
  discordDmUserId: string;
  discordAppName: string;
  discordEnabled: boolean;
}

function loadEnvFile(rootDir: string): void {
  const envPath = resolve(rootDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(rootDir: string = process.cwd()): AppConfig {
  loadEnvFile(rootDir);

  const promptFile = resolve(rootDir, process.env.RALPH_PROMPT_FILE ?? 'prompts/supervisor.md');
  const taskCatalogFile = resolve(rootDir, process.env.RALPH_TASK_CATALOG_FILE ?? 'prd.json');
  const stateDir = resolve(rootDir, process.env.RALPH_STATE_DIR ?? 'state');
  const logDir = resolve(rootDir, process.env.RALPH_LOG_DIR ?? 'logs');
  const mode = (process.env.RALPH_AGENT_MODE ?? 'command') as RunMode;
  const discordToken = process.env.RALPH_DISCORD_TOKEN ?? '';

  return {
    rootDir,
    promptFile,
    taskCatalogFile,
    stateDir,
    logDir,
    agentCommand:
      process.env.RALPH_AGENT_COMMAND ??
      'codex exec --full-auto --skip-git-repo-check',
    mode,
    maxIterations: envNumber('RALPH_MAX_ITERATIONS', 20),
    idleSeconds: envNumber('RALPH_IDLE_SECONDS', 5),
    panelPort: envNumber('RALPH_PANEL_PORT', 8787),
    panelHost: process.env.RALPH_PANEL_HOST ?? '127.0.0.1',
    taskName: process.env.RALPH_TASK_NAME ?? 'Codex supervised run',
    discordToken,
    discordNotifyChannelId: process.env.RALPH_DISCORD_NOTIFY_CHANNEL_ID ?? '',
    discordDmUserId: process.env.RALPH_DISCORD_DM_USER_ID ?? '',
    discordAppName: process.env.RALPH_DISCORD_APP_NAME ?? 'RalphLoop',
    discordEnabled: discordToken.length > 0,
  };
}
