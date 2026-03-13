import { bootstrapSystem } from './bootstrap.ts';

await bootstrapSystem({
  startPanel: true,
  startSupervisor: true,
  startDiscord: true,
  autoStartRun: false,
});
