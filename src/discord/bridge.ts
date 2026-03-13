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
      `🚀 RalphLoop 開始\nrun=${status.runId}\nmode=${status.mode}\ntask=${status.task}`,
    );
  }

  async notifyStatus(message: string): Promise<void> {
    await this.sendNotification(`📌 STATUS\n${message}`);
  }

  async notifyQuestion(question: QuestionRecord): Promise<void> {
    await this.sendNotification(`❓ QUESTION ${question.id}\n${question.text}`);
  }

  async notifyBlocker(blocker: BlockerRecord): Promise<void> {
    await this.sendNotification(`⛔ BLOCKER ${blocker.id}\n${blocker.text}`);
  }

  async notifyDone(message: string): Promise<void> {
    await this.sendNotification(`✅ DONE\n${message}`);
  }

  async notifyRunAborted(reason: string): Promise<void> {
    await this.sendNotification(`🛑 ABORT\n${reason}`);
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
      await this.sendNotification('🤖 RalphLoop Discord bridge connected');
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

    if (command === '/status') {
      const status = this.actions.getStatus();
      const settings = this.actions.getRuntimeSettings();
      await this.sendMessage(
        event.channel_id,
        [
          `state=${status.lifecycle}`,
          `iteration=${status.iteration}/${status.maxIterations}`,
          `status=${status.currentStatusText}`,
          `task=${settings.taskName}`,
          `mode=${settings.mode}`,
          `maxIterations=${settings.maxIterations}`,
        ].join('\n'),
      );
      return;
    }

    if (command === '/config') {
      const settings = this.actions.getRuntimeSettings();
      await this.sendMessage(
        event.channel_id,
        [
          `task=${settings.taskName}`,
          `mode=${settings.mode}`,
          `maxIterations=${settings.maxIterations}`,
          `idleSeconds=${settings.idleSeconds}`,
          `agentCommand=${settings.agentCommand}`,
          `promptFile=${settings.promptFile}`,
          `promptOverride=${settings.promptBody.trim() ? 'enabled' : 'disabled'}`,
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
      await this.sendMessage(event.channel_id, `paused: ${status.lifecycle}`);
      return;
    }

    if (command === '/resume') {
      const status = await this.actions.resumeRun({ source: 'discord' });
      await this.sendMessage(event.channel_id, `resumed: ${status.lifecycle}`);
      return;
    }

    if (command === '/abort') {
      const status = await this.actions.abortRun({ source: 'discord' });
      this.hooks.onAbort?.();
      await this.sendMessage(event.channel_id, `abort requested: ${status.lifecycle}`);
      return;
    }

    if (command === '/answer') {
      const questionId = rest[0];
      const answer = rest.slice(1).join(' ').trim();
      if (!questionId || !answer) {
        await this.sendMessage(event.channel_id, 'usage: /answer Q-001 staging を優先してください');
        return;
      }

      await this.actions.submitAnswer(questionId, answer, { source: 'discord' });
      await this.sendMessage(event.channel_id, `${questionId} に回答を保存しました`);
      return;
    }

    if (command === '/note') {
      const note = restRaw;
      if (!note) {
        await this.sendMessage(event.channel_id, 'usage: /note 次ターンで staging を優先');
        return;
      }

      await this.actions.enqueueManualNote(note, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'note を queue に追加しました');
      return;
    }

    if (command === '/set-task') {
      const taskName = restRaw;
      if (!taskName) {
        await this.sendMessage(event.channel_id, 'usage: /set-task repo-wide rebuild');
        return;
      }

      await this.actions.updateRuntimeSettings({ taskName }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'task を更新しました');
      return;
    }

    if (command === '/set-iterations') {
      const value = Number.parseInt(rest[0] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        await this.sendMessage(event.channel_id, 'usage: /set-iterations 40');
        return;
      }

      await this.actions.updateRuntimeSettings({ maxIterations: value }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'maxIterations を更新しました');
      return;
    }

    if (command === '/set-idle') {
      const value = Number.parseInt(rest[0] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        await this.sendMessage(event.channel_id, 'usage: /set-idle 3');
        return;
      }

      await this.actions.updateRuntimeSettings({ idleSeconds: value }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'idleSeconds を更新しました');
      return;
    }

    if (command === '/set-mode') {
      const mode = rest[0] === 'demo' ? 'demo' : rest[0] === 'command' ? 'command' : null;
      if (!mode) {
        await this.sendMessage(event.channel_id, 'usage: /set-mode command|demo');
        return;
      }

      await this.actions.updateRuntimeSettings({ mode }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'mode を更新しました');
      return;
    }

    if (command === '/set-agent') {
      const agentCommand = restRaw;
      if (!agentCommand) {
        await this.sendMessage(event.channel_id, 'usage: /set-agent codex exec --full-auto --skip-git-repo-check');
        return;
      }

      await this.actions.updateRuntimeSettings({ agentCommand }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'agentCommand を更新しました');
      return;
    }

    if (command === '/set-prompt-file') {
      const promptFile = restRaw;
      if (!promptFile) {
        await this.sendMessage(event.channel_id, 'usage: /set-prompt-file /abs/path/to/prompt.md');
        return;
      }

      await this.actions.updateRuntimeSettings({ promptFile }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'promptFile を更新しました');
      return;
    }

    if (command === '/set-prompt') {
      const promptBody = restRaw;
      if (!promptBody) {
        await this.sendMessage(event.channel_id, 'usage: /set-prompt ここに prompt override を書く');
        return;
      }

      await this.actions.updateRuntimeSettings({ promptBody }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'prompt override を更新しました');
      return;
    }

    if (command === '/clear-prompt') {
      await this.actions.updateRuntimeSettings({ promptBody: '' }, { source: 'discord' });
      await this.sendMessage(event.channel_id, 'prompt override をクリアしました');
    }
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
