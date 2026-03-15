import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { assessConfig, type AppConfig } from './config.ts';

function createBaseConfig(): AppConfig {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-config-'));
  const promptFile = join(rootDir, 'prompt.md');
  writeFileSync(promptFile, '# prompt\n', 'utf8');

  return {
    rootDir,
    promptFile,
    taskCatalogFile: '',
    stateDir: join(rootDir, 'state'),
    logDir: join(rootDir, 'logs'),
    agentCommand: 'codex exec --full-auto --skip-git-repo-check',
    mode: 'command',
    maxIterations: 20,
    idleSeconds: 5,
    panelPort: 8787,
    panelHost: '127.0.0.1',
    panelUsername: '',
    panelPassword: '',
    allowRuntimeAgentCommandOverride: false,
    taskName: 'release check',
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

test('assessConfig reports a healthy command-mode setup as releasable', () => {
  const config = createBaseConfig();
  const assessment = assessConfig(config);

  assert.equal(assessment.ok, true);
  assert.equal(assessment.summary.error, 0);
  assert.match(
    assessment.items.find((item) => item.key === 'promptFile')?.message || '',
    /promptFile:/,
  );
});

test('assessConfig warns about partial auth and empty task catalog without failing', () => {
  const config = createBaseConfig();
  config.panelUsername = 'ralph';

  const assessment = assessConfig(config);

  assert.equal(assessment.ok, true);
  assert.ok(assessment.summary.warning >= 2);
  assert.equal(
    assessment.items.find((item) => item.key === 'panelAuth')?.level,
    'warning',
  );
});

test('assessConfig fails when prompt or command settings are invalid', () => {
  const config = createBaseConfig();
  config.promptFile = join(config.rootDir, 'missing-prompt.md');
  config.agentCommand = '';

  const assessment = assessConfig(config);

  assert.equal(assessment.ok, false);
  assert.ok(assessment.summary.error >= 2);
  assert.equal(
    assessment.items.find((item) => item.key === 'agentCommand')?.level,
    'error',
  );
  assert.equal(
    assessment.items.find((item) => item.key === 'promptFile')?.level,
    'error',
  );
});

test('assessConfig warns when runtime agent command override is enabled without protections', () => {
  const config = createBaseConfig();
  config.allowRuntimeAgentCommandOverride = true;
  config.discordToken = 'token';
  config.discordEnabled = true;

  const assessment = assessConfig(config);

  assert.equal(
    assessment.items.find((item) => item.key === 'runtimeAgentCommand')?.level,
    'warning',
  );
  assert.equal(
    assessment.items.find((item) => item.key === 'runtimeAgentCommandPanelRisk')?.level,
    'warning',
  );
  assert.equal(
    assessment.items.find((item) => item.key === 'runtimeAgentCommandDiscordRisk')?.level,
    'warning',
  );
});
