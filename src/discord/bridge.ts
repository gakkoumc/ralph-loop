import type { RunActions } from '../actions/run-actions.ts';
import type { AppConfig } from '../config.ts';
import type { Notifier } from '../shared/notifier.ts';
import type { BlockerRecord, QuestionRecord, RunStatus } from '../shared/types.ts';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const INTENT_GUILDS = 1 << 0;
const INTENT_GUILD_MESSAGES = 1 << 9;
const INTENT_DIRECT_MESSAGES = 1 << 12;
const INTENT_MESSAGE_CONTENT = 1 << 15;

interface GatewayPayload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

interface MessageCreateEvent {
  channel_id: string;
  content: string;
  author: {
    bot?: boolean;
  };
}

interface TaskDraftPayload {
  title?: string;
  summary?: string;
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

  return items.map((item) => `- ${item.id} [${item.displayStatus}] ${item.title}`).join('\n');
}

export class DiscordBridge implements Notifier {
  private gateway: WebSocket | null = null;
  private heartbeatHandle: NodeJS.Timeout | null = null;
  private sequence: number | null = null;
  private dmChannelId: string | null = null;
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
      await this.sendNotification('🤖 RalphLoop の Discord 連携を開始しました');
      return;
    }

    if (payload.t === 'MESSAGE_CREATE') {
      await this.handleIncomingCommand(payload.d as MessageCreateEvent);
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

  private async handleIncomingCommand(event: MessageCreateEvent): Promise<void> {
    if (event.author.bot || !event.content.startsWith('/')) {
      return;
    }

    const trimmed = event.content.trim();
    const firstSpaceIndex = trimmed.search(/\s/);
    const command =
      firstSpaceIndex === -1 ? trimmed : trimmed.slice(0, firstSpaceIndex);
    const restRaw =
      firstSpaceIndex === -1 ? '' : trimmed.slice(firstSpaceIndex).trim();
    const rest = restRaw ? restRaw.split(/\s+/) : [];

    if (command === '/help') {
      await this.sendMessage(
        event.channel_id,
        [
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
          '/set-agent codex exec ...',
          '/set-prompt-file /abs/path/to/prompt.md',
          '/set-prompt ここに prompt を直接書く',
          '/clear-prompt',
        ].join('\n'),
      );
      return;
    }

    if (command === '/status') {
      const status = this.actions.getStatus();
      const settings = this.actions.getRuntimeSettings();
      await this.sendMessage(
        event.channel_id,
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

    if (command === '/config') {
      const settings = this.actions.getRuntimeSettings();
      await this.sendMessage(
        event.channel_id,
        [
          `Task: ${settings.taskName}`,
          `実行: ${modeLabel(settings.mode)}`,
          `思考回数: ${settings.maxIterations}`,
          `待機秒数: ${settings.idleSeconds}`,
          `agentCommand: ${settings.agentCommand}`,
          `promptFile: ${settings.promptFile}`,
          `prompt上書き: ${settings.promptBody.trim() ? 'あり' : 'なし'}`,
        ].join('\n'),
      );
      return;
    }

    if (command === '/start') {
      const requestedTask = restRaw;
      if (requestedTask) {
        await this.actions.updateRuntimeSettings({ taskName: requestedTask }, { source: 'discord' });
      }
      const result = await this.actions.requestRunStart({ source: 'discord' });
      await this.sendMessage(event.channel_id, result.message);
      return;
    }

    if (command === '/pause') {
      const status = await this.actions.pauseRun({ source: 'discord' });
      await this.sendMessage(event.channel_id, `一時停止しました: ${lifecycleLabel(status.lifecycle)}`);
      return;
    }

    if (command === '/resume') {
      const status = await this.actions.resumeRun({ source: 'discord' });
      await this.sendMessage(event.channel_id, `再開しました: ${lifecycleLabel(status.lifecycle)}`);
      return;
    }

    if (command === '/abort') {
      const status = await this.actions.abortRun({ source: 'discord' });
      this.hooks.onAbort?.();
      await this.sendMessage(event.channel_id, `中断を受け付けました: ${lifecycleLabel(status.lifecycle)}`);
      return;
    }

    if (command === '/tasks') {
      const dashboard = await this.actions.getDashboardData();
      await this.sendMessage(
        event.channel_id,
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

    if (command === '/task-add') {
      const draft = splitTaskDraft(restRaw);
      if (!draft.title) {
        await this.sendMessage(event.channel_id, '使い方: /task-add タイトル | 説明');
        return;
      }

      const task = await this.actions.createTask(draft, { source: 'discord' });
      await this.sendMessage(event.channel_id, `${task.id} を追加しました`);
      return;
    }

    if (command === '/task-edit') {
      const taskId = rest[0];
      const draft = splitTaskDraft(rest.slice(1).join(' '));
      if (!taskId || !draft.title) {
        await this.sendMessage(event.channel_id, '使い方: /task-edit T-001 タイトル | 説明');
        return;
      }

      const task = await this.actions.updateTask(taskId, draft, { source: 'discord' });
      await this.sendMessage(
        event.channel_id,
        task ? `${task.id} を更新しました` : '指定した Task が見つかりません',
      );
      return;
    }

    if (command === '/task-done') {
      const taskId = rest[0];
      if (!taskId) {
        await this.sendMessage(event.channel_id, '使い方: /task-done T-001');
        return;
      }

      const task = await this.actions.completeTask(taskId, { source: 'discord' });
      await this.sendMessage(
        event.channel_id,
        task ? `${task.id} に完了チェックを付けました` : '指定した Task が見つかりません',
      );
      return;
    }

    if (command === '/task-reopen') {
      const taskId = rest[0];
      if (!taskId) {
        await this.sendMessage(event.channel_id, '使い方: /task-reopen T-001');
        return;
      }

      const task = await this.actions.reopenTask(taskId, { source: 'discord' });
      await this.sendMessage(
        event.channel_id,
        task ? `${task.id} を未完了に戻しました` : '指定した Task が見つかりません',
      );
      return;
    }

    if (command === '/answer') {
      const questionId = rest[0];
      const answer = rest.slice(1).join(' ').trim();
      if (!questionId || !answer) {
        await this.sendMessage(event.channel_id, '使い方: /answer Q-001 staging を優先してください');
        return;
      }

      await this.actions.submitAnswer(questionId, answer, { source: 'discord' });
      await this.sendMessage(event.channel_id, `${questionId} に回答を保存しました`);
      return;
    }

    if (command === '/note') {
      const note = restRaw;
      if (!note) {
        await this.sendMessage(event.channel_id, '使い方: /note 次ターンで staging を優先');
        return;
      }

      await this.actions.enqueueManualNote(note, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'メモを次ターン用に追加しました');
      return;
    }

    if (command === '/set-task') {
      const taskName = restRaw;
      if (!taskName) {
        await this.sendMessage(event.channel_id, '使い方: /set-task repo-wide rebuild');
        return;
      }

      await this.actions.updateRuntimeSettings({ taskName }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'Task 名を更新しました');
      return;
    }

    if (command === '/set-iterations') {
      const value = Number.parseInt(rest[0] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        await this.sendMessage(event.channel_id, '使い方: /set-iterations 40');
        return;
      }

      await this.actions.updateRuntimeSettings({ maxIterations: value }, { source: 'discord' });
      await this.sendMessage(event.channel_id, '思考回数を更新しました');
      return;
    }

    if (command === '/set-idle') {
      const value = Number.parseInt(rest[0] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        await this.sendMessage(event.channel_id, '使い方: /set-idle 3');
        return;
      }

      await this.actions.updateRuntimeSettings({ idleSeconds: value }, { source: 'discord' });
      await this.sendMessage(event.channel_id, '待機秒数を更新しました');
      return;
    }

    if (command === '/set-mode') {
      const mode = rest[0] === 'demo' ? 'demo' : rest[0] === 'command' ? 'command' : null;
      if (!mode) {
        await this.sendMessage(event.channel_id, '使い方: /set-mode command|demo');
        return;
      }

      await this.actions.updateRuntimeSettings({ mode }, { source: 'discord' });
      await this.sendMessage(event.channel_id, '実行モードを更新しました');
      return;
    }

    if (command === '/set-agent') {
      const agentCommand = restRaw;
      if (!agentCommand) {
        await this.sendMessage(event.channel_id, '使い方: /set-agent codex exec --full-auto --skip-git-repo-check');
        return;
      }

      await this.actions.updateRuntimeSettings({ agentCommand }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'agentCommand を更新しました');
      return;
    }

    if (command === '/set-prompt-file') {
      const promptFile = restRaw;
      if (!promptFile) {
        await this.sendMessage(event.channel_id, '使い方: /set-prompt-file /abs/path/to/prompt.md');
        return;
      }

      await this.actions.updateRuntimeSettings({ promptFile }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'prompt ファイルを更新しました');
      return;
    }

    if (command === '/set-prompt') {
      const promptBody = restRaw;
      if (!promptBody) {
        await this.sendMessage(event.channel_id, '使い方: /set-prompt ここに prompt override を書く');
        return;
      }

      await this.actions.updateRuntimeSettings({ promptBody }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'prompt 上書きを更新しました');
      return;
    }

    if (command === '/clear-prompt') {
      await this.actions.updateRuntimeSettings({ promptBody: '' }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'prompt 上書きをクリアしました');
      return;
    }

    await this.sendMessage(event.channel_id, '不明なコマンドです。/help で一覧を表示できます');
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

      console.error('discord: failed to create DM channel', await response.text());
    }

    return this.config.discordNotifyChannelId || null;
  }

  private async sendMessage(channelId: string, content: string): Promise<void> {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      console.error('discord: failed to send message', await response.text());
    }
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bot ${this.config.discordToken}`,
      'content-type': 'application/json',
    };
  }
}
