import { bootstrapSystem } from './bootstrap.ts';

await bootstrapSystem({
  startPanel: false,
  startSupervisor: true,
  startDiscord: false,
  autoStartRun: true,
});
