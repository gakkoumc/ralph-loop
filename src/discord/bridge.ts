import type { RunActions } from '../actions/run-actions.ts';
import type { AppConfig } from '../config.ts';
import type { Notifier } from '../shared/notifier.ts';
import type { BlockerRecord, QuestionRecord, RunStatus } from '../shared/types.ts';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const INTENT_GUILDS = 1 << 0;
const INTENT_GUILD_MESSAGES = 1 << 9;
const INTENT_DIRECT_MESSAGES = 1 << 12;
const INTENT_MESSAGE_CONTENT = 1 << 15;
const APPLICATION_COMMAND_OPTION_TYPE_STRING = 3;
const APPLICATION_COMMAND_OPTION_TYPE_INTEGER = 4;
const INTERACTION_CALLBACK_TYPE_CHANNEL_MESSAGE_WITH_SOURCE = 4;
const MESSAGE_FLAG_EPHEMERAL = 1 << 6;
const DISCORD_MESSAGE_LIMIT = 1900;

interface GatewayPayload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

interface ReadyEvent {
  application?: {
    id?: string;
  };
}

interface MessageCreateEvent {
  channel_id: string;
  content: string;
  author: {
    bot?: boolean;
    id: string;
  };
}

interface InteractionCommandOption {
  name: string;
  type: number;
  value?: string | number;
}

interface InteractionCreateEvent {
  id: string;
  token: string;
  channel_id: string;
  data?: {
    name?: string;
    options?: InteractionCommandOption[];
  };
  member?: {
    user?: {
      id: string;
    };
  };
  user?: {
    id: string;
  };
}

interface SlashCommandDefinition {
  name: string;
  description: string;
  options?: Array<{
    type: number;
    name: string;
    description: string;
    required?: boolean;
  }>;
}

interface TaskDraftPayload {
  title?: string;
  summary?: string;
}

type CommandReply = (content: string) => Promise<void>;

function canEditAgentCommandRemotely(config: AppConfig): boolean {
  return config.allowRuntimeAgentCommandOverride;
}

function describeCommandError(error: unknown): string {
  return error instanceof Error ? error.message : 'コマンドを処理できませんでした';
}

function modeLabel(mode: string): string {
  return mode === 'demo' ? 'デモ' : '通常';
}

function lifecycleLabel(state: string): string {
  if (state === 'starting') {
    return '開始中';
  }

  if (state === 'running') {
    return '実行中';
  }

  if (state === 'paused') {
    return '一時停止';
  }

  if (state === 'pause_requested') {
    return '停止待ち';
  }

  if (state === 'completed') {
    return '完了';
  }

  if (state === 'aborted') {
    return '中断';
  }

  if (state === 'failed') {
    return '失敗';
  }

  return '待機';
}

function splitTaskDraft(raw: string): TaskDraftPayload {
  const [titlePart, ...summaryParts] = raw
    .split('|')
    .map((part) => part.trim());

  return {
    title: titlePart || undefined,
    summary: summaryParts.join(' | ').trim() || undefined,
  };
}

function renderTaskList(
  items: Array<{ id: string; title: string; displayStatus: string }>,
  fallback: string,
): string {
  if (items.length === 0) {
    return fallback;
  }

  const statusLabel = (value: string): string => {
    if (value === 'active') {
      return '現在';
    }

    if (value === 'queued') {
      return '待機';
    }

    if (value === 'completed') {
      return '完了';
    }

    return '停止';
  };

  return items.map((item) => `- ${item.id} [${statusLabel(item.displayStatus)}] ${item.title}`).join('\n');
}

function optionMap(options?: InteractionCommandOption[]): Map<string, string | number> {
  return new Map((options ?? []).map((option) => [option.name, option.value ?? '']));
}

function commandDefinitions(config: AppConfig): SlashCommandDefinition[] {
  const commands: SlashCommandDefinition[] = [
    { name: 'help', description: '使えるコマンド一覧を表示します' },
    { name: 'status', description: '現在の状態を表示します' },
    { name: 'config', description: '現在の実行設定を表示します' },
    {
      name: 'start',
      description: 'run を開始します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'task',
          description: '開始前に更新したい Task 名',
        },
      ],
    },
    { name: 'pause', description: '実行を一時停止します' },
    { name: 'resume', description: '実行を再開します' },
    { name: 'abort', description: '実行を中断します' },
    { name: 'tasks', description: 'Task 一覧を表示します' },
    {
      name: 'task-add',
      description: 'Task を追加します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'title',
          description: 'Task 名',
          required: true,
        },
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'summary',
          description: 'Task の説明',
        },
      ],
    },
    {
      name: 'task-edit',
      description: 'Task を編集します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'task_id',
          description: '編集する Task ID',
          required: true,
        },
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'title',
          description: '新しい Task 名',
          required: true,
        },
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'summary',
          description: '新しい説明',
        },
      ],
    },
    {
      name: 'task-done',
      description: 'Task を完了にします',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'task_id',
          description: '完了にする Task ID',
          required: true,
        },
      ],
    },
    {
      name: 'task-reopen',
      description: 'Task を未完了へ戻します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'task_id',
          description: '戻す Task ID',
          required: true,
        },
      ],
    },
    {
      name: 'answer',
      description: '質問に回答します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'question_id',
          description: '質問 ID',
          required: true,
        },
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'answer',
          description: '回答文',
          required: true,
        },
      ],
    },
    {
      name: 'note',
      description: '次ターン用メモを追加します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'note',
          description: 'メモ本文',
          required: true,
        },
      ],
    },
    {
      name: 'set-task',
      description: 'Task 名を更新します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'task',
          description: '新しい Task 名',
          required: true,
        },
      ],
    },
    {
      name: 'set-iterations',
      description: '思考回数を更新します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_INTEGER,
          name: 'count',
          description: '思考回数',
          required: true,
        },
      ],
    },
    {
      name: 'set-idle',
      description: '待機秒数を更新します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_INTEGER,
          name: 'seconds',
          description: '待機秒数',
          required: true,
        },
      ],
    },
    {
      name: 'set-mode',
      description: '実行モードを更新します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'mode',
          description: 'command または demo',
          required: true,
        },
      ],
    },
    {
      name: 'set-prompt-file',
      description: 'prompt ファイルを更新します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'path',
          description: 'prompt ファイルの絶対パス',
          required: true,
        },
      ],
    },
    {
      name: 'set-prompt',
      description: 'prompt 上書きを設定します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'body',
          description: 'prompt 本文',
          required: true,
        },
      ],
    },
    { name: 'clear-prompt', description: 'prompt 上書きを解除します' },
  ];

  if (canEditAgentCommandRemotely(config)) {
    const insertIndex = commands.findIndex((command) => command.name === 'set-prompt-file');
    commands.splice(insertIndex >= 0 ? insertIndex : commands.length, 0, {
      name: 'set-agent',
      description: 'agent command を更新します',
      options: [
        {
          type: APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'command',
          description: '実行コマンド',
          required: true,
        },
      ],
    });
  }

  return commands;
}

export class DiscordBridge implements Notifier {
  private gateway: WebSocket | null = null;
  private heartbeatHandle: NodeJS.Timeout | null = null;
  private sequence: number | null = null;
  private dmChannelId: string | null = null;
  private applicationId: string | null = null;
  private readonly config: AppConfig;
  private readonly actions: RunActions;
  private readonly hooks: { onAbort?: () => void };

  constructor(
    config: AppConfig,
    actions: RunActions,
    hooks: { onAbort?: () => void } = {},
  ) {
    this.config = config;
    this.actions = actions;
    this.hooks = hooks;
    this.applicationId = config.discordApplicationId || null;
  }

  async start(): Promise<void> {
    if (!this.config.discordEnabled) {
      console.log('discord: disabled');
      return;
    }

    this.gateway = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    this.gateway.addEventListener('message', (event) => {
      void this.onGatewayMessage(String(event.data));
    });
    this.gateway.addEventListener('close', () => {
      this.stopHeartbeat();
      console.log('discord: gateway closed');
    });
  }

  async notifyRunStarted(status: RunStatus): Promise<void> {
    await this.sendNotification(
      `🚀 RalphLoop を開始しました\nrun=${status.runId}\n実行=${modeLabel(status.mode)}\nTask=${status.task}`,
    );
  }

  async notifyStatus(message: string): Promise<void> {
    await this.sendNotification(`📌 状態更新\n${message}`);
  }

  async notifyQuestion(question: QuestionRecord): Promise<void> {
    await this.sendNotification(`❓ 確認 ${question.id}\n${question.text}`);
  }

  async notifyBlocker(blocker: BlockerRecord): Promise<void> {
    await this.sendNotification(`⛔ 要対応 ${blocker.id}\n${blocker.text}`);
  }

  async notifyDone(message: string): Promise<void> {
    await this.sendNotification(`✅ 完了\n${message}`);
  }

  async notifyRunAborted(reason: string): Promise<void> {
    await this.sendNotification(`🛑 中断\n${reason}`);
  }

  private async onGatewayMessage(raw: string): Promise<void> {
    const payload = JSON.parse(raw) as GatewayPayload;
    this.sequence = payload.s ?? this.sequence;

    if (payload.op === 10) {
      const data = payload.d as { heartbeat_interval: number };
      this.startHeartbeat(data.heartbeat_interval);
      this.identify();
      return;
    }

    if (payload.t === 'READY') {
      const ready = payload.d as ReadyEvent;
      this.applicationId = ready.application?.id ?? this.applicationId;
      await this.registerSlashCommands();
      await this.sendNotification('🤖 RalphLoop の Discord 連携を開始しました');
      return;
    }

    if (payload.t === 'MESSAGE_CREATE') {
      await this.handleIncomingMessage(payload.d as MessageCreateEvent);
      return;
    }

    if (payload.t === 'INTERACTION_CREATE') {
      await this.handleInteraction(payload.d as InteractionCreateEvent);
    }
  }

  private identify(): void {
    this.sendGateway({
      op: 2,
      d: {
        token: this.config.discordToken,
        intents:
          INTENT_GUILDS |
          INTENT_GUILD_MESSAGES |
          INTENT_DIRECT_MESSAGES |
          INTENT_MESSAGE_CONTENT,
        properties: {
          os: process.platform,
          browser: 'ralph-loop',
          device: 'ralph-loop',
        },
      },
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatHandle = setInterval(() => {
      this.sendGateway({ op: 1, d: this.sequence });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatHandle) {
      return;
    }

    clearInterval(this.heartbeatHandle);
    this.heartbeatHandle = null;
  }

  private sendGateway(payload: { op: number; d: unknown }): void {
    if (!this.gateway || this.gateway.readyState !== WebSocket.OPEN) {
      return;
    }

    this.gateway.send(JSON.stringify(payload));
  }

  private isUserAllowed(userId: string): boolean {
    if (this.config.discordAllowedUserIds.length === 0) {
      return true;
    }

    return this.config.discordAllowedUserIds.includes(userId);
  }

  private async handleIncomingMessage(event: MessageCreateEvent): Promise<void> {
    if (event.author.bot || !event.content.startsWith('/')) {
      return;
    }

    if (!this.isUserAllowed(event.author.id)) {
      await this.sendMessage(event.channel_id, 'この Discord アカウントには操作権限がありません');
      return;
    }

    const trimmed = event.content.trim();
    const firstSpaceIndex = trimmed.search(/\s/);
    const command =
      firstSpaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, firstSpaceIndex);
    const restRaw =
      firstSpaceIndex === -1 ? '' : trimmed.slice(firstSpaceIndex).trim();
    const rest = restRaw ? restRaw.split(/\s+/) : [];

    try {
      await this.executeCommand(command, restRaw, rest, async (content) => {
        await this.sendMessage(event.channel_id, content);
      });
    } catch (error) {
      await this.sendMessage(event.channel_id, describeCommandError(error));
    }
  }

  private async handleInteraction(event: InteractionCreateEvent): Promise<void> {
    const command = event.data?.name?.trim();
    const userId = event.member?.user?.id ?? event.user?.id ?? '';
    if (!command || !userId) {
      return;
    }

    if (!this.isUserAllowed(userId)) {
      await this.respondToInteraction(event.id, event.token, 'この Discord アカウントには操作権限がありません');
      return;
    }

    const options = optionMap(event.data?.options);
    const args = this.buildSlashCommandArgs(command, options);
    try {
      await this.executeCommand(
        command,
        args.restRaw,
        args.rest,
        async (content) => {
          await this.respondToInteraction(event.id, event.token, content);
        },
      );
    } catch (error) {
      await this.respondToInteraction(event.id, event.token, describeCommandError(error));
    }
  }

  private buildSlashCommandArgs(
    command: string,
    options: Map<string, string | number>,
  ): { restRaw: string; rest: string[] } {
    const value = (key: string): string => String(options.get(key) ?? '').trim();

    if (command === 'start') {
      const task = value('task');
      return { restRaw: task, rest: task ? [task] : [] };
    }

    if (command === 'task-add') {
      const title = value('title');
      const summary = value('summary');
      const restRaw = summary ? `${title} | ${summary}` : title;
      return { restRaw, rest: [title, summary].filter(Boolean) };
    }

    if (command === 'task-edit') {
      const taskId = value('task_id');
      const title = value('title');
      const summary = value('summary');
      const restRaw = [taskId, summary ? `${title} | ${summary}` : title].filter(Boolean).join(' ');
      return { restRaw, rest: [taskId, title, summary].filter(Boolean) };
    }

    if (command === 'task-done' || command === 'task-reopen') {
      const taskId = value('task_id');
      return { restRaw: taskId, rest: taskId ? [taskId] : [] };
    }

    if (command === 'answer') {
      const questionId = value('question_id');
      const answer = value('answer');
      return { restRaw: `${questionId} ${answer}`.trim(), rest: [questionId, answer].filter(Boolean) };
    }

    if (command === 'note') {
      const note = value('note');
      return { restRaw: note, rest: note ? [note] : [] };
    }

    if (command === 'set-task') {
      const task = value('task');
      return { restRaw: task, rest: task ? [task] : [] };
    }

    if (command === 'set-iterations') {
      const count = value('count');
      return { restRaw: count, rest: count ? [count] : [] };
    }

    if (command === 'set-idle') {
      const seconds = value('seconds');
      return { restRaw: seconds, rest: seconds ? [seconds] : [] };
    }

    if (command === 'set-mode') {
      const mode = value('mode');
      return { restRaw: mode, rest: mode ? [mode] : [] };
    }

    if (command === 'set-agent') {
      const commandValue = value('command');
      return { restRaw: commandValue, rest: commandValue ? [commandValue] : [] };
    }

    if (command === 'set-prompt-file') {
      const path = value('path');
      return { restRaw: path, rest: path ? [path] : [] };
    }

    if (command === 'set-prompt') {
      const body = value('body');
      return { restRaw: body, rest: body ? [body] : [] };
    }

    return { restRaw: '', rest: [] };
  }

  private async executeCommand(
    command: string,
    restRaw: string,
    rest: string[],
    reply: CommandReply,
  ): Promise<void> {
    if (command === 'help') {
      const lines = [
        '使えるコマンド:',
        '/status',
        '/config',
        '/start [task]',
        '/pause',
        '/resume',
        '/abort',
        '/tasks',
        '/task-add タイトル | 説明',
        '/task-edit T-001 タイトル | 説明',
        '/task-done T-001',
        '/task-reopen T-001',
        '/answer Q-001 回答文',
        '/note 次ターンのメモ',
        '/set-task Task名',
        '/set-iterations 12',
        '/set-idle 3',
        '/set-mode command|demo',
        '/set-prompt-file /abs/path/to/prompt.md',
        '/set-prompt ここに prompt 上書きを書く',
        '/clear-prompt',
      ];

      if (canEditAgentCommandRemotely(this.config)) {
        lines.splice(lines.indexOf('/set-prompt-file /abs/path/to/prompt.md'), 0, '/set-agent codex exec ...');
      }

      await reply(
        lines.join('\n'),
      );
      return;
    }

    if (command === 'status') {
      const status = this.actions.getStatus();
      const settings = this.actions.getRuntimeSettings();
      await reply(
        [
          `状態: ${lifecycleLabel(status.lifecycle)}`,
          `思考回数: ${status.iteration}/${status.maxIterations}`,
          `現在: ${status.currentStatusText || '-'}`,
          `Task: ${settings.taskName}`,
          `実行: ${modeLabel(settings.mode)}`,
          `最大反復: ${settings.maxIterations}`,
        ].join('\n'),
      );
      return;
    }

    if (command === 'config') {
      const settings = this.actions.getRuntimeSettings();
      await reply(
        [
          `Task: ${settings.taskName}`,
          `実行: ${modeLabel(settings.mode)}`,
          `思考回数: ${settings.maxIterations}`,
          `待機秒数: ${settings.idleSeconds}`,
          `agentCommand: ${settings.agentCommand}`,
          `promptFile: ${settings.promptFile || '(未設定)'}`,
          `prompt上書き: ${settings.promptBody.trim() ? 'あり' : 'なし'}`,
        ].join('\n'),
      );
      return;
    }

    if (command === 'start') {
      const requestedTask = restRaw;
      if (requestedTask) {
        await this.actions.updateRuntimeSettings({ taskName: requestedTask }, { source: 'discord' });
      }
      const result = await this.actions.requestRunStart({ source: 'discord' });
      await reply(result.message);
      return;
    }

    if (command === 'pause') {
      const status = await this.actions.pauseRun({ source: 'discord' });
      await reply(`一時停止しました: ${lifecycleLabel(status.lifecycle)}`);
      return;
    }

    if (command === 'resume') {
      const status = await this.actions.resumeRun({ source: 'discord' });
      await reply(`再開しました: ${lifecycleLabel(status.lifecycle)}`);
      return;
    }

    if (command === 'abort') {
      const status = await this.actions.abortRun({ source: 'discord' });
      this.hooks.onAbort?.();
      await reply(`中断を受け付けました: ${lifecycleLabel(status.lifecycle)}`);
      return;
    }

    if (command === 'tasks') {
      const dashboard = await this.actions.getDashboardData();
      await reply(
        [
          `現在のTask: ${dashboard.currentTask ? `${dashboard.currentTask.id} ${dashboard.currentTask.title}` : 'なし'}`,
          `次のTask: ${dashboard.nextTask ? `${dashboard.nextTask.id} ${dashboard.nextTask.title}` : 'なし'}`,
          `完了: ${dashboard.status.completedTaskCount} / 全体: ${dashboard.status.totalTaskCount}`,
          '',
          'Task一覧:',
          renderTaskList(dashboard.taskBoard.slice(0, 10), '- Task はまだありません'),
        ].join('\n'),
      );
      return;
    }

    if (command === 'task-add') {
      const draft = splitTaskDraft(restRaw);
      if (!draft.title) {
        await reply('使い方: /task-add タイトル | 説明');
        return;
      }

      const task = await this.actions.createTask(draft, { source: 'discord' });
      await reply(`${task.id} を追加しました`);
      return;
    }

    if (command === 'task-edit') {
      const taskId = rest[0];
      const draft = splitTaskDraft(restRaw.slice(taskId.length).trim());
      if (!taskId || !draft.title) {
        await reply('使い方: /task-edit T-001 タイトル | 説明');
        return;
      }

      const task = await this.actions.updateTask(taskId, draft, { source: 'discord' });
      await reply(task ? `${task.id} を更新しました` : '指定した Task が見つかりません');
      return;
    }

    if (command === 'task-done') {
      const taskId = rest[0];
      if (!taskId) {
        await reply('使い方: /task-done T-001');
        return;
      }

      const task = await this.actions.completeTask(taskId, { source: 'discord' });
      await reply(task ? `${task.id} に完了チェックを付けました` : '指定した Task が見つかりません');
      return;
    }

    if (command === 'task-reopen') {
      const taskId = rest[0];
      if (!taskId) {
        await reply('使い方: /task-reopen T-001');
        return;
      }

      const task = await this.actions.reopenTask(taskId, { source: 'discord' });
      await reply(task ? `${task.id} を未完了に戻しました` : '指定した Task が見つかりません');
      return;
    }

    if (command === 'answer') {
      const questionId = rest[0];
      const answer = rest.slice(1).join(' ').trim();
      if (!questionId || !answer) {
        await reply('使い方: /answer Q-001 staging を優先してください');
        return;
      }

      await this.actions.submitAnswer(questionId, answer, { source: 'discord' });
      await reply(`${questionId} に回答を保存しました`);
      return;
    }

    if (command === 'note') {
      const note = restRaw;
      if (!note) {
        await reply('使い方: /note 次ターンで staging を優先');
        return;
      }

      await this.actions.enqueueManualNote(note, { source: 'discord' });
      await reply('メモを次ターン用に追加しました');
      return;
    }

    if (command === 'set-task') {
      const taskName = restRaw;
      if (!taskName) {
        await reply('使い方: /set-task repo-wide rebuild');
        return;
      }

      await this.actions.updateRuntimeSettings({ taskName }, { source: 'discord' });
      await reply('Task 名を更新しました');
      return;
    }

    if (command === 'set-iterations') {
      const value = Number.parseInt(rest[0] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        await reply('使い方: /set-iterations 40');
        return;
      }

      await this.actions.updateRuntimeSettings({ maxIterations: value }, { source: 'discord' });
      await reply('思考回数を更新しました');
      return;
    }

    if (command === 'set-idle') {
      const value = Number.parseInt(rest[0] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        await reply('使い方: /set-idle 3');
        return;
      }

      await this.actions.updateRuntimeSettings({ idleSeconds: value }, { source: 'discord' });
      await reply('待機秒数を更新しました');
      return;
    }

    if (command === 'set-mode') {
      const mode = rest[0] === 'demo' ? 'demo' : rest[0] === 'command' ? 'command' : null;
      if (!mode) {
        await reply('使い方: /set-mode command|demo');
        return;
      }

      await this.actions.updateRuntimeSettings({ mode }, { source: 'discord' });
      await reply('実行モードを更新しました');
      return;
    }

    if (command === 'set-agent') {
      if (!canEditAgentCommandRemotely(this.config)) {
        await reply('agentCommand は起動時設定に固定されています。CLI または環境変数で変更してください');
        return;
      }

      const agentCommand = restRaw;
      if (!agentCommand) {
        await reply('使い方: /set-agent codex exec --full-auto --skip-git-repo-check');
        return;
      }

      await this.actions.updateRuntimeSettings({ agentCommand }, { source: 'discord' });
      await reply('agentCommand を更新しました');
      return;
    }

    if (command === 'set-prompt-file') {
      const promptFile = restRaw;
      if (!promptFile) {
        await reply('使い方: /set-prompt-file /abs/path/to/prompt.md');
        return;
      }

      await this.actions.updateRuntimeSettings({ promptFile }, { source: 'discord' });
      await reply('prompt ファイルを更新しました');
      return;
    }

    if (command === 'set-prompt') {
      const promptBody = restRaw;
      if (!promptBody) {
        await reply('使い方: /set-prompt ここに prompt 上書きを書く');
        return;
      }

      await this.actions.updateRuntimeSettings({ promptBody }, { source: 'discord' });
      await reply('prompt 上書きを更新しました');
      return;
    }

    if (command === 'clear-prompt') {
      await this.actions.updateRuntimeSettings({ promptBody: '' }, { source: 'discord' });
      await reply('prompt 上書きをクリアしました');
      return;
    }

    await reply('不明なコマンドです。/help で一覧を表示できます');
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.applicationId) {
      console.warn('discord: application id が取得できなかったため slash command 登録をスキップします');
      return;
    }

    const path = this.config.discordGuildId
      ? `${DISCORD_API_BASE}/applications/${this.applicationId}/guilds/${this.config.discordGuildId}/commands`
      : `${DISCORD_API_BASE}/applications/${this.applicationId}/commands`;

    const response = await fetch(path, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(commandDefinitions(this.config)),
    });

    if (!response.ok) {
      console.error('discord: slash command 登録に失敗しました', await response.text());
      return;
    }

    console.log('discord: slash command を登録しました');
  }

  private async sendNotification(content: string): Promise<void> {
    if (!this.config.discordEnabled) {
      return;
    }

    const channelId = await this.resolveNotificationChannelId();
    if (!channelId) {
      return;
    }

    await this.sendMessage(channelId, content);
  }

  private async resolveNotificationChannelId(): Promise<string | null> {
    if (this.config.discordDmUserId) {
      if (this.dmChannelId) {
        return this.dmChannelId;
      }

      const response = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ recipient_id: this.config.discordDmUserId }),
      });

      if (response.ok) {
        const payload = (await response.json()) as { id: string };
        this.dmChannelId = payload.id;
        return this.dmChannelId;
      }

      console.error('discord: DM channel の作成に失敗しました', await response.text());
    }

    return this.config.discordNotifyChannelId || null;
  }

  private normalizeContent(content: string): string {
    if (content.length <= DISCORD_MESSAGE_LIMIT) {
      return content;
    }

    return `${content.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
  }

  private async sendMessage(channelId: string, content: string): Promise<void> {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content: this.normalizeContent(content) }),
    });

    if (!response.ok) {
      console.error('discord: メッセージ送信に失敗しました', await response.text());
    }
  }

  private async respondToInteraction(interactionId: string, token: string, content: string): Promise<void> {
    const response = await fetch(`${DISCORD_API_BASE}/interactions/${interactionId}/${token}/callback`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        type: INTERACTION_CALLBACK_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: this.normalizeContent(content),
          flags: MESSAGE_FLAG_EPHEMERAL,
        },
      }),
    });

    if (!response.ok) {
      console.error('discord: interaction 応答に失敗しました', await response.text());
    }
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bot ${this.config.discordToken}`,
      'content-type': 'application/json',
    };
  }
}
