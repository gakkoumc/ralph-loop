import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AppConfig } from '../config.ts';
import { FileStateStore } from './store.ts';

function makeConfig(rootDir: string): AppConfig {
  return {
    rootDir,
    promptFile: join(rootDir, 'prompts', 'supervisor.md'),
    taskCatalogFile: '',
    stateDir: join(rootDir, 'state'),
    logDir: join(rootDir, 'logs'),
    agentCommand: 'codex exec --full-auto --skip-git-repo-check',
    mode: 'command',
    maxIterations: 5,
    idleSeconds: 1,
    panelPort: 8787,
    panelHost: '127.0.0.1',
    panelUsername: '',
    panelPassword: '',
    allowRuntimeAgentCommandOverride: false,
    taskName: 'state test',
    discordToken: '',
    discordNotifyChannelId: '',
    discordDmUserId: '',
    discordAppName: 'RalphLoop',
    discordAllowedUserIds: [],
    discordGuildId: '',
    discordApplicationId: '',
    discordEnabled: false,
  };
}

test('FileStateStore falls back safely when a JSON state file is corrupted', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-store-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', 'utf8');

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();

  const statusPath = join(config.stateDir, 'status.json');
  writeFileSync(statusPath, '{"broken":', 'utf8');

  const originalWarn = console.warn;
  const warnCalls: unknown[][] = [];
  console.warn = (...args) => {
    warnCalls.push(args);
  };
  let status;
  try {
    status = store.readStatus();
  } finally {
    console.warn = originalWarn;
  }
  const stateFiles = readdirSync(config.stateDir);

  assert.equal(status.task, config.taskName);
  assert.equal(existsSync(statusPath), false);
  assert.ok(stateFiles.some((fileName) => fileName.startsWith('status.json.corrupt-')));
  assert.equal(warnCalls.length, 1);

  rmSync(rootDir, { recursive: true, force: true });
});
