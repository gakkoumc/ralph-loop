import { bootstrapSystem } from './bootstrap.ts';

await bootstrapSystem({
  startPanel: true,
  startSupervisor: false,
  startDiscord: false,
  autoStartRun: false,
});
