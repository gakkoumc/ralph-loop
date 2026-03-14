import { loadConfig } from '../config.ts';
import { bootstrapSystem } from './bootstrap.ts';

process.env.RALPH_AGENT_MODE = 'demo';
process.env.RALPH_TASK_NAME = process.env.RALPH_TASK_NAME ?? 'Demo run';
process.env.RALPH_MAX_ITERATIONS = process.env.RALPH_MAX_ITERATIONS ?? '6';

const config = loadConfig();
await bootstrapSystem({
  startPanel: true,
  startSupervisor: true,
  startDiscord: false,
  autoStartRun: true,
  config,
});
