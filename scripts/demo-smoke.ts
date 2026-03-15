import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { loadConfig } from '../src/config.ts';
import { bootstrapSystem } from '../src/cli/bootstrap.ts';

const rootDir = process.cwd();
const sandboxDir = await mkdtemp(join(tmpdir(), 'ralph-smoke-'));
const stateDir = join(sandboxDir, 'state');
const logDir = join(sandboxDir, 'logs');
const answerInboxPath = join(stateDir, 'answer-inbox.jsonl');
const panelPort = process.env.RALPH_SMOKE_PANEL_PORT ?? '8787';

process.env.RALPH_AGENT_MODE = 'demo';
process.env.RALPH_AGENT_COMMAND = '';
process.env.RALPH_PROMPT_FILE = 'prompts/supervisor.md';
process.env.RALPH_TASK_CATALOG_FILE = '';
process.env.RALPH_STATE_DIR = stateDir;
process.env.RALPH_LOG_DIR = logDir;
process.env.RALPH_MAX_ITERATIONS = '6';
process.env.RALPH_IDLE_SECONDS = '1';
process.env.RALPH_TASK_NAME = 'Smoke demo';
process.env.RALPH_PANEL_HOST = '127.0.0.1';
process.env.RALPH_PANEL_PORT = panelPort;
process.env.RALPH_PANEL_USERNAME = '';
process.env.RALPH_PANEL_PASSWORD = '';
process.env.RALPH_ALLOW_RUNTIME_AGENT_COMMAND_OVERRIDE = 'false';
process.env.RALPH_DISCORD_TOKEN = '';
process.env.RALPH_DISCORD_NOTIFY_CHANNEL_ID = '';
process.env.RALPH_DISCORD_DM_USER_ID = '';
process.env.RALPH_DISCORD_APP_NAME = 'RalphLoop';
process.env.RALPH_DISCORD_ALLOWED_USER_IDS = '';
process.env.RALPH_DISCORD_GUILD_ID = '';
process.env.RALPH_DISCORD_APPLICATION_ID = '';

const config = loadConfig(rootDir);
const runtime = await bootstrapSystem({
  startPanel: true,
  startSupervisor: true,
  startDiscord: false,
  autoStartRun: true,
  config,
});

async function queueDemoAnswer(questionId: string): Promise<void> {
  const line = JSON.stringify({
    questionId,
    answer: 'staging を優先してください',
  });
  await appendFile(answerInboxPath, `${line}\n`, 'utf8');
}

try {
  const deadline = Date.now() + 30000;
  let answerQueued = false;
  let completed = false;

  while (Date.now() < deadline) {
    const status = runtime.actions.getStatus();

    if (!answerQueued && status.pendingQuestionCount > 0) {
      await queueDemoAnswer(status.lastQuestionId || 'Q-001');
      answerQueued = true;
    }

    if (status.lifecycle === 'completed') {
      console.log('demo smoke ok');
      completed = true;
      break;
    }

    if (status.lifecycle === 'failed' || status.lifecycle === 'aborted') {
      throw new Error(`demo smoke ended in unexpected state: ${status.lifecycle}`);
    }

    await delay(500);
  }

  if (!completed) {
    throw new Error('demo smoke timed out before completion');
  }
} finally {
  runtime.supervisor.stopWatching();
  await new Promise<void>((resolve, reject) => {
    if (!runtime.panelServer) {
      resolve();
      return;
    }
    runtime.panelServer.close((error) => {
      if ((error as { code?: string } | undefined)?.code === 'ERR_SERVER_NOT_RUNNING') {
        resolve();
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await rm(sandboxDir, { recursive: true, force: true });
}
