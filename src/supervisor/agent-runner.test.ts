import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AppConfig } from '../config.ts';
import { AgentRunner } from './agent-runner.ts';

function makeConfig(rootDir: string): AppConfig {
  return {
    rootDir,
    promptFile: join(rootDir, 'prompts', 'supervisor.md'),
    taskCatalogFile: '',
    stateDir: join(rootDir, 'state'),
    logDir: join(rootDir, 'logs'),
    agentCommand: 'node -e "setInterval(() => {}, 1000)"',
    mode: 'command',
    maxIterations: 5,
    idleSeconds: 1,
    panelPort: 8787,
    panelHost: '127.0.0.1',
    panelUsername: '',
    panelPassword: '',
    allowRuntimeAgentCommandOverride: false,
    taskName: 'runner-test',
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

test('AgentRunner abortCurrent terminates an in-flight command run', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-runner-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', 'utf8');

  const runner = new AgentRunner(makeConfig(rootDir));
  const pending = runner.run('prompt', 1);

  await new Promise((resolve) => setTimeout(resolve, 100));
  runner.abortCurrent();

  const result = await pending;

  assert.equal(result.exitCode, null);
  assert.ok(result.signal === 'SIGTERM' || result.signal === 'SIGKILL');

  rmSync(rootDir, { recursive: true, force: true });
});
