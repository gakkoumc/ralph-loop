import { bootstrapSystem } from './bootstrap.ts';
import { loadConfig, type AppConfig } from '../config.ts';
import { FileStateStore } from '../state/store.ts';
import { RunActions } from '../actions/run-actions.ts';

type RalphCommand =
  | 'start'
  | 'run'
  | 'start-run'
  | 'configure'
  | 'panel'
  | 'supervisor'
  | 'discord'
  | 'demo'
  | 'status'
  | 'help';

interface ParsedArgs {
  command: RalphCommand;
  overrides: Partial<AppConfig>;
  startPanel: boolean;
  startSupervisor: boolean;
  startDiscord: boolean;
  autoStartRun: boolean;
  json: boolean;
}

function renderHelp(): string {
  return [
    'ralph <command> [options]',
    '',
    'Commands:',
    '  ralph                    Start the always-on Ralph service',
    '  ralph start [task]       Start the always-on Ralph service',
    '  ralph run [task]         Start the full stack and immediately run once',
    '  ralph start-run [task]   Queue a run for an already-running service',
    '  ralph configure [opts]   Persist runtime settings without starting the service',
    '  ralph panel              Start only the web panel',
    '  ralph supervisor         Start only the supervisor loop',
    '  ralph discord            Start only the Discord bridge',
    '  ralph demo [task]        Start demo mode and immediately run it',
    '  ralph status             Print the current dashboard snapshot',
    '  ralph help               Show this help',
    '',
    'Options:',
    '  --task <text>            Override the run task label',
    '  --agent-command <cmd>    Override the child agent command',
    '  --prompt-file <path>     Override the prompt file path',
    '  --mode <command|demo>    Override the run mode',
    '  --panel-host <host>      Override panel host',
    '  --panel-port <port>      Override panel port',
    '  --max-iterations <n>     Override max iterations',
    '  --idle-seconds <n>       Override idle seconds',
    '  --json                   Print status as JSON for `ralph status`',
  ].join('\n');
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveCommand(value?: string): RalphCommand | null {
  if (!value) {
    return 'start';
  }

  if (
    ['start', 'run', 'start-run', 'configure', 'panel', 'supervisor', 'discord', 'demo', 'status', 'help'].includes(
      value,
    )
  ) {
    return value as RalphCommand;
  }

  return null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const first = argv[0];
  const explicitCommand = resolveCommand(first);
  const args = explicitCommand ? argv.slice(1) : argv;
  const command = explicitCommand ?? 'start';
  const overrides: Partial<AppConfig> = {};
  const positionals: string[] = [];
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === '--help' || value === '-h') {
      return {
        command: 'help',
        overrides,
        startPanel: true,
        startSupervisor: true,
        startDiscord: true,
        autoStartRun: false,
        json,
      };
    }

    if (value === '--json') {
      json = true;
      continue;
    }

    if (value === '--task' || value === '-t') {
      overrides.taskName = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (value === '--agent-command') {
      overrides.agentCommand = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (value === '--prompt-file') {
      overrides.promptFile = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (value === '--mode') {
      const mode = args[index + 1];
      if (mode === 'command' || mode === 'demo') {
        overrides.mode = mode;
      }
      index += 1;
      continue;
    }

    if (value === '--panel-host') {
      overrides.panelHost = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (value === '--panel-port') {
      overrides.panelPort = toNumber(args[index + 1], 8787);
      index += 1;
      continue;
    }

    if (value === '--max-iterations') {
      overrides.maxIterations = toNumber(args[index + 1], 20);
      index += 1;
      continue;
    }

    if (value === '--idle-seconds') {
      overrides.idleSeconds = toNumber(args[index + 1], 5);
      index += 1;
      continue;
    }

    positionals.push(value);
  }

  if (!overrides.taskName && positionals.length > 0) {
    overrides.taskName = positionals.join(' ');
  }

  const modes: Record<
    RalphCommand,
    Pick<ParsedArgs, 'startPanel' | 'startSupervisor' | 'startDiscord' | 'autoStartRun'>
  > = {
    start: { startPanel: true, startSupervisor: true, startDiscord: true, autoStartRun: false },
    run: { startPanel: true, startSupervisor: true, startDiscord: true, autoStartRun: true },
    'start-run': { startPanel: false, startSupervisor: false, startDiscord: false, autoStartRun: false },
    configure: { startPanel: false, startSupervisor: false, startDiscord: false, autoStartRun: false },
    panel: { startPanel: true, startSupervisor: false, startDiscord: false, autoStartRun: false },
    supervisor: { startPanel: false, startSupervisor: true, startDiscord: false, autoStartRun: true },
    discord: { startPanel: false, startSupervisor: false, startDiscord: true, autoStartRun: false },
    demo: { startPanel: true, startSupervisor: true, startDiscord: false, autoStartRun: true },
    status: { startPanel: false, startSupervisor: false, startDiscord: false, autoStartRun: false },
    help: { startPanel: false, startSupervisor: false, startDiscord: false, autoStartRun: false },
  };

  if (command === 'demo') {
    overrides.mode = 'demo';
    overrides.taskName = overrides.taskName || 'Ralph orchestration demo';
  }

  return {
    command,
    overrides,
    ...modes[command],
    json,
  };
}

function applyOverrides(config: AppConfig, overrides: Partial<AppConfig>): AppConfig {
  const merged = {
    ...config,
    ...overrides,
  };

  return {
    ...merged,
    discordEnabled: (overrides.discordToken ?? merged.discordToken).length > 0,
  };
}

async function printStatus(config: AppConfig, json: boolean): Promise<void> {
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);
  const dashboard = await actions.getDashboardData();

  if (json) {
    console.log(JSON.stringify(dashboard, null, 2));
    return;
  }

  console.log([
    `task: ${dashboard.status.task}`,
    `lifecycle: ${dashboard.status.lifecycle}`,
    `phase: ${dashboard.status.phase}`,
    `iteration: ${dashboard.status.iteration}/${dashboard.status.maxIterations}`,
    `maxIntegration: ${dashboard.status.maxIntegration}`,
    `tasks: ${dashboard.status.activeTaskCount} active / ${dashboard.status.queuedTaskCount} queued / ${dashboard.status.completedTaskCount} completed`,
    `questions: ${dashboard.status.pendingQuestionCount} pending / ${dashboard.status.answeredQuestionCount} answered`,
    `thinking: ${dashboard.thinkingFrames[0] ?? dashboard.status.currentStatusText ?? '-'}`,
  ].join('\n'));
}

async function configureRuntime(config: AppConfig, overrides: Partial<AppConfig>): Promise<void> {
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);
  await actions.recoverInterruptedRun({ source: 'cli' });
  const settings = await actions.updateRuntimeSettings(
    {
      taskName: overrides.taskName,
      agentCommand: overrides.agentCommand,
      promptFile: overrides.promptFile,
      maxIterations: overrides.maxIterations,
      idleSeconds: overrides.idleSeconds,
      mode: overrides.mode,
    },
    { source: 'cli' },
  );

  console.log(
    [
      'runtime settings updated',
      `task: ${settings.taskName}`,
      `mode: ${settings.mode}`,
      `maxIterations: ${settings.maxIterations}`,
      `idleSeconds: ${settings.idleSeconds}`,
    ].join('\n'),
  );
}

async function queueRun(config: AppConfig, overrides: Partial<AppConfig>): Promise<void> {
  const store = new FileStateStore(config);
  await store.ensureInitialized();
  const actions = new RunActions(store, config);
  await actions.recoverInterruptedRun({ source: 'cli' });

  if (
    overrides.taskName ||
    overrides.agentCommand ||
    overrides.promptFile ||
    overrides.maxIterations ||
    overrides.idleSeconds ||
    overrides.mode
  ) {
    await actions.updateRuntimeSettings(
      {
        taskName: overrides.taskName,
        agentCommand: overrides.agentCommand,
        promptFile: overrides.promptFile,
        maxIterations: overrides.maxIterations,
        idleSeconds: overrides.idleSeconds,
        mode: overrides.mode,
      },
      { source: 'cli' },
    );
  }

  const result = await actions.requestRunStart({ source: 'cli' });
  console.log(result.message);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === 'help') {
    console.log(renderHelp());
    return;
  }

  const config = applyOverrides(loadConfig(), parsed.overrides);

  if (parsed.command === 'status') {
    await printStatus(config, parsed.json);
    return;
  }

  if (parsed.command === 'configure') {
    await configureRuntime(config, parsed.overrides);
    return;
  }

  if (parsed.command === 'start-run') {
    await queueRun(config, parsed.overrides);
    return;
  }

  await bootstrapSystem({
    startPanel: parsed.startPanel,
    startSupervisor: parsed.startSupervisor,
    startDiscord: parsed.startDiscord,
    autoStartRun: parsed.autoStartRun,
    config,
  });
}

await main();
