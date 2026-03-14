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
    'コマンド:',
    '  ralph                    常駐サービスを起動',
    '  ralph start [task]       常駐サービスを起動',
    '  ralph run [task]         全体を起動してそのまま 1 回実行',
    '  ralph start-run [task]   既存サービスに実行予約を追加',
    '  ralph configure [opts]   サービスを起動せず実行設定だけ保存',
    '  ralph panel              Web パネルだけ起動',
    '  ralph supervisor         監督ループだけ起動',
    '  ralph discord            Discord 連携だけ起動',
    '  ralph demo [task]        デモモードで起動してすぐ実行',
    '  ralph status             現在の状態を表示',
    '  ralph help               このヘルプを表示',
    '',
    '日本語エイリアス:',
    '  起動=start  実行=run  実行予約=start-run  設定=configure  画面=panel',
    '  監督=supervisor  ディスコード=discord  デモ=demo  状態=status  ヘルプ=help',
    '',
    'オプション:',
    '  --task <text>            実行する Task 名を上書き',
    '  --agent-command <cmd>    実行エージェントのコマンドを上書き',
    '  --prompt-file <path>     prompt ファイルのパスを上書き',
    '  --mode <command|demo>    実行モードを上書き',
    '  --panel-host <host>      panel の host を上書き',
    '  --panel-port <port>      panel の port を上書き',
    '  --max-iterations <n>     思考回数を上書き',
    '  --idle-seconds <n>       待機秒数を上書き',
    '  --json                   `ralph status` を JSON で出力',
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

  const aliases: Record<string, RalphCommand> = {
    start: 'start',
    起動: 'start',
    run: 'run',
    実行: 'run',
    'start-run': 'start-run',
    実行予約: 'start-run',
    configure: 'configure',
    設定: 'configure',
    panel: 'panel',
    画面: 'panel',
    supervisor: 'supervisor',
    監督: 'supervisor',
    discord: 'discord',
    ディスコード: 'discord',
    demo: 'demo',
    デモ: 'demo',
    status: 'status',
    状態: 'status',
    help: 'help',
    ヘルプ: 'help',
  };

  if (aliases[value]) {
    return aliases[value];
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
    overrides.taskName = overrides.taskName || 'Ralph デモ実行';
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
    `Task: ${dashboard.status.task}`,
    `状態: ${dashboard.status.lifecycle}`,
    `進行: ${dashboard.status.phase}`,
    `反復: ${dashboard.status.iteration}/${dashboard.status.maxIterations}`,
    `MaxIntegration: ${dashboard.status.maxIntegration}`,
    `Task数: ${dashboard.status.activeTaskCount} 件進行中 / ${dashboard.status.queuedTaskCount} 件待機 / ${dashboard.status.completedTaskCount} 件完了`,
    `現在のTask: ${dashboard.currentTask ? `${dashboard.currentTask.id} ${dashboard.currentTask.title}` : '-'}`,
    `次のTask: ${dashboard.nextTask ? `${dashboard.nextTask.id} ${dashboard.nextTask.title}` : '-'}`,
    `質問: ${dashboard.status.pendingQuestionCount} 件待ち / ${dashboard.status.answeredQuestionCount} 件回答済み`,
    `思考: ${dashboard.thinkingFrames[0] ?? dashboard.status.currentStatusText ?? '-'}`,
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
      '実行設定を更新しました',
      `Task: ${settings.taskName}`,
      `実行方式: ${settings.mode === 'demo' ? 'デモ' : '通常実行'}`,
      `最大思考回数: ${settings.maxIterations}`,
      `待機秒数: ${settings.idleSeconds}`,
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
