import { bootstrapSystem } from './bootstrap.ts';

await bootstrapSystem({
  startPanel: false,
  startSupervisor: false,
  startDiscord: true,
  autoStartRun: false,
});
