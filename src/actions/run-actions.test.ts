import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { AppConfig } from '../config.ts';
import { FileStateStore } from '../state/store.ts';
import { RunActions } from './run-actions.ts';

function makeConfig(rootDir: string): AppConfig {
  return {
    rootDir,
    promptFile: join(rootDir, 'prompts', 'supervisor.md'),
    taskCatalogFile: join(rootDir, 'prd.json'),
    stateDir: join(rootDir, 'state'),
    logDir: join(rootDir, 'logs'),
    agentCommand: 'demo',
    mode: 'demo',
    maxIterations: 5,
    idleSeconds: 1,
    panelPort: 8787,
    panelHost: '127.0.0.1',
    panelUsername: '',
    panelPassword: '',
    allowRuntimeAgentCommandOverride: false,
    taskName: 'test',
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

test('RunActions consumes local answer inbox once and injects it only once', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });
  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  await actions.recordQuestion('staging を優先しますか？');
  writeFileSync(
    join(config.stateDir, 'answer-inbox.jsonl'),
    `${JSON.stringify({ questionId: 'Q-001', answer: 'staging を優先してください' })}\n`,
    'utf8',
  );

  const prompt = await actions.preparePromptForNextTurn();
  const secondPrompt = await actions.preparePromptForNextTurn();

  assert.match(prompt, /現在の orchestration snapshot:/);
  assert.match(prompt, /先ほどの質問の答えが届きました/);
  assert.match(prompt, /Q-001: staging を優先してください/);
  assert.match(secondPrompt, /現在の orchestration snapshot:/);
  assert.doesNotMatch(secondPrompt, /先ほどの質問の答えが届きました/);

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions derives MaxIntegration from prd task volume', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });
  writeFileSync(
    join(rootDir, 'prd.json'),
    JSON.stringify(
      {
        userStories: [
          { id: 'US-001', title: 'one', priority: 1, passes: false },
          { id: 'US-002', title: 'two', priority: 2, passes: false },
          { id: 'US-003', title: 'three', priority: 3, passes: false },
          { id: 'US-004', title: 'four', priority: 4, passes: false },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  const dashboard = await actions.getDashboardData();

  assert.equal(dashboard.status.totalTaskCount, 4);
  assert.equal(dashboard.status.maxIntegration, 3);
  assert.equal(dashboard.agentLanes.filter((lane) => lane.role === 'worker').length, 3);

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions starts empty when no task catalog is configured', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  config.taskCatalogFile = '';
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  const dashboard = await actions.getDashboardData();

  assert.equal(dashboard.taskBoard.length, 0);
  assert.equal(dashboard.currentTask, undefined);
  assert.equal(dashboard.nextTask, undefined);

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions updates runtime settings and exposes them in dashboard', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  await actions.updateRuntimeSettings(
    {
      taskName: 'runtime task',
      maxIterations: 9,
      promptBody: 'inline prompt',
    },
    { source: 'test' },
  );

  const dashboard = await actions.getDashboardData();

  assert.equal(dashboard.settings.taskName, 'runtime task');
  assert.equal(dashboard.settings.maxIterations, 9);
  assert.equal(dashboard.settings.promptBody, 'inline prompt');
  assert.equal(config.maxIterations, 9);
  assert.equal(config.taskName, 'runtime task');

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions requestRunStart clears previous run artifacts', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  await actions.recordQuestion('staging?');
  await actions.submitAnswer('Q-001', 'yes', { source: 'test' });
  await actions.recordBlocker('token missing');

  const result = await actions.requestRunStart({ source: 'test' });

  assert.equal(result.started, true);
  assert.equal(store.readQuestions().length, 0);
  assert.equal(store.readAnswers().length, 0);
  assert.equal(store.readBlockers().length, 0);
  assert.equal(result.status.iteration, 0);

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions requestRunStart rejects duplicate queued runs', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  const first = await actions.requestRunStart({ source: 'test' });
  const second = await actions.requestRunStart({ source: 'test' });

  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(second.message, 'run はすでに待機列にあります');

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions requestRunStart rejects invalid prompt settings', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  await actions.updateRuntimeSettings(
    {
      promptFile: join(rootDir, 'missing.md'),
      promptBody: '',
    },
    { source: 'test' },
  );

  const result = await actions.requestRunStart({ source: 'test' });

  assert.equal(result.started, false);
  assert.match(result.message, /promptFile が見つかりません/);

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions recovers stale active run state on bootstrap', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  const status = store.readStatus();
  status.lifecycle = 'running';
  status.phase = 'running';
  status.control = 'running';
  store.writeStatus(status);

  const recovered = await actions.recoverInterruptedRun({ source: 'test' });

  assert.ok(recovered);
  assert.equal(recovered?.lifecycle, 'failed');
  assert.equal(recovered?.phase, 'interrupted');

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions creates, updates, completes, and reopens tasks while tracking current and next task', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });
  writeFileSync(
    join(rootDir, 'prd.json'),
    JSON.stringify(
      {
        userStories: [
          { id: 'US-001', title: '最初のTask', priority: 1, passes: false },
          { id: 'US-002', title: '次のTask', priority: 2, passes: false },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  const initial = await actions.getDashboardData();
  assert.equal(initial.currentTask?.id, 'US-001');
  assert.equal(initial.nextTask?.id, 'US-002');

  const created = await actions.createTask(
    { title: '追加Task', summary: 'あとで取り組むTask' },
    { source: 'test' },
  );
  assert.equal(created.id, 'T-001');

  const updated = await actions.updateTask(
    created.id,
    { title: '追加Task更新', summary: '説明も更新' },
    { source: 'test' },
  );
  assert.equal(updated?.title, '追加Task更新');
  assert.equal(updated?.summary, '説明も更新');

  await actions.moveTask(created.id, 'front', { source: 'test' });
  const afterMoveFront = await actions.getDashboardData();
  assert.equal(afterMoveFront.currentTask?.id, created.id);
  assert.equal(afterMoveFront.nextTask?.id, 'US-001');

  await actions.moveTask(created.id, 'back', { source: 'test' });
  const afterMoveBack = await actions.getDashboardData();
  assert.equal(afterMoveBack.currentTask?.id, 'US-001');
  assert.equal(afterMoveBack.nextTask?.id, 'US-002');

  await actions.completeTask('US-001', { source: 'test' });
  const afterComplete = await actions.getDashboardData();
  assert.equal(afterComplete.currentTask?.id, 'US-002');
  assert.equal(afterComplete.taskBoard.find((task) => task.id === 'US-001')?.displayStatus, 'completed');

  await actions.reopenTask('US-001', { source: 'test' });
  const afterReopen = await actions.getDashboardData();
  assert.equal(afterReopen.currentTask?.id, 'US-001');
  assert.equal(afterReopen.nextTask?.id, 'US-002');
  assert.equal(afterReopen.taskBoard.find((task) => task.id === created.id)?.title, '追加Task更新');

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions rejects remote agentCommand overrides by default but allows local CLI changes', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  await assert.rejects(
    actions.updateRuntimeSettings(
      { agentCommand: 'dangerous remote override' },
      { source: 'web' },
    ),
    /agentCommand は起動時設定に固定されています/,
  );

  const updated = await actions.updateRuntimeSettings(
    { agentCommand: 'safe local override' },
    { source: 'cli' },
  );

  assert.equal(updated.agentCommand, 'safe local override');
  assert.equal(config.agentCommand, 'safe local override');

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions preserves manual seeded task edits across task catalog synchronization', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });
  writeFileSync(
    join(rootDir, 'prd.json'),
    JSON.stringify(
      {
        userStories: [
          { id: 'US-001', title: 'seed title', priority: 1, passes: false },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = makeConfig(rootDir);
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  await actions.getDashboardData();
  await actions.updateTask(
    'US-001',
    { title: 'manual title', summary: 'manual summary' },
    { source: 'web' },
  );

  const dashboard = await actions.getDashboardData();
  const task = dashboard.taskBoard.find((item) => item.id === 'US-001');

  assert.equal(task?.title, 'manual title');
  assert.equal(task?.summary, 'manual summary');
  assert.equal(task?.titleOverride, 'manual title');
  assert.equal(task?.summaryOverride, 'manual summary');

  rmSync(rootDir, { recursive: true, force: true });
});

test('RunActions previews and imports tasks from pasted specs in order', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ralph-loop-'));
  mkdirSync(join(rootDir, 'prompts'), { recursive: true });
  writeFileSync(join(rootDir, 'prompts', 'supervisor.md'), 'base prompt', { encoding: 'utf8' });

  const config = makeConfig(rootDir);
  config.taskCatalogFile = '';
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);

  const spec = `
## API
- 認証APIを作る
  - パスワード認証が通る
- 監査ログを残す
  - 成功と失敗を記録する
`;

  const preview = await actions.previewTaskImport(spec);
  assert.equal(preview.format, 'list');
  assert.equal(preview.tasks.length, 2);
  assert.equal(preview.tasks[0]?.title, '認証APIを作る');

  const imported = await actions.importTasksFromSpec(spec, { source: 'web' });
  assert.equal(imported.tasks.length, 2);
  assert.equal(imported.tasks[0]?.id, 'T-001');
  assert.equal(imported.tasks[1]?.id, 'T-002');
  assert.deepEqual(imported.tasks[0]?.acceptanceCriteria, ['パスワード認証が通る']);

  const dashboard = await actions.getDashboardData();
  assert.equal(dashboard.currentTask?.id, 'T-001');
  assert.equal(dashboard.nextTask?.id, 'T-002');
  assert.equal(dashboard.taskBoard[1]?.summary, 'API');

  rmSync(rootDir, { recursive: true, force: true });
});
