import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RunMode } from './shared/types.ts';

export interface AppConfig {
  rootDir: string;
  promptFile: string;
  taskCatalogFile: string;
  stateDir: string;
  logDir: string;
  agentCommand: string;
  mode: RunMode;
  maxIterations: number;
  idleSeconds: number;
  panelPort: number;
  panelHost: string;
  panelUsername: string;
  panelPassword: string;
  allowRuntimeAgentCommandOverride: boolean;
  taskName: string;
  discordToken: string;
  discordNotifyChannelId: string;
  discordDmUserId: string;
  discordAppName: string;
  discordAllowedUserIds: string[];
  discordGuildId: string;
  discordApplicationId: string;
  discordEnabled: boolean;
}

export interface ConfigCheckItem {
  key: string;
  level: 'ok' | 'warning' | 'error';
  message: string;
}

export interface ConfigAssessment {
  ok: boolean;
  items: ConfigCheckItem[];
  summary: {
    ok: number;
    warning: number;
    error: number;
  };
}

function loadEnvFile(rootDir: string): void {
  const envPath = resolve(rootDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) {
    return false;
  }

  return fallback;
}

function pushConfigCheck(
  items: ConfigCheckItem[],
  key: string,
  level: ConfigCheckItem['level'],
  message: string,
): void {
  items.push({ key, level, message });
}

export function loadConfig(rootDir: string = process.cwd()): AppConfig {
  loadEnvFile(rootDir);

  const promptFile = resolve(rootDir, process.env.RALPH_PROMPT_FILE ?? 'prompts/supervisor.md');
  const taskCatalogEnv = (process.env.RALPH_TASK_CATALOG_FILE ?? '').trim();
  const taskCatalogFile = taskCatalogEnv ? resolve(rootDir, taskCatalogEnv) : '';
  const stateDir = resolve(rootDir, process.env.RALPH_STATE_DIR ?? 'state');
  const logDir = resolve(rootDir, process.env.RALPH_LOG_DIR ?? 'logs');
  const mode = (process.env.RALPH_AGENT_MODE ?? 'command') as RunMode;
  const discordToken = process.env.RALPH_DISCORD_TOKEN ?? '';
  const discordAllowedUserIds = (process.env.RALPH_DISCORD_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    rootDir,
    promptFile,
    taskCatalogFile,
    stateDir,
    logDir,
    agentCommand:
      process.env.RALPH_AGENT_COMMAND ??
      'codex exec --full-auto --skip-git-repo-check',
    mode,
    maxIterations: envNumber('RALPH_MAX_ITERATIONS', 20),
    idleSeconds: envNumber('RALPH_IDLE_SECONDS', 5),
    panelPort: envNumber('RALPH_PANEL_PORT', 8787),
    panelHost: process.env.RALPH_PANEL_HOST ?? '127.0.0.1',
    panelUsername: process.env.RALPH_PANEL_USERNAME ?? '',
    panelPassword: process.env.RALPH_PANEL_PASSWORD ?? '',
    allowRuntimeAgentCommandOverride: envBoolean('RALPH_ALLOW_RUNTIME_AGENT_COMMAND_OVERRIDE', false),
    taskName: process.env.RALPH_TASK_NAME ?? 'Codex supervised run',
    discordToken,
    discordNotifyChannelId: process.env.RALPH_DISCORD_NOTIFY_CHANNEL_ID ?? '',
    discordDmUserId: process.env.RALPH_DISCORD_DM_USER_ID ?? '',
    discordAppName: process.env.RALPH_DISCORD_APP_NAME ?? 'RalphLoop',
    discordAllowedUserIds,
    discordGuildId: process.env.RALPH_DISCORD_GUILD_ID ?? '',
    discordApplicationId: process.env.RALPH_DISCORD_APPLICATION_ID ?? '',
    discordEnabled: discordToken.length > 0,
  };
}

export function assessConfig(config: AppConfig): ConfigAssessment {
  const items: ConfigCheckItem[] = [];

  if (config.taskName.trim()) {
    pushConfigCheck(items, 'taskName', 'ok', `Task 名: ${config.taskName}`);
  } else {
    pushConfigCheck(items, 'taskName', 'error', 'RALPH_TASK_NAME が空です');
  }

  if (config.mode === 'command' || config.mode === 'demo') {
    pushConfigCheck(items, 'mode', 'ok', `実行モード: ${config.mode}`);
  } else {
    pushConfigCheck(items, 'mode', 'error', `未対応の実行モードです: ${config.mode}`);
  }

  if (config.promptFile.trim() && existsSync(config.promptFile)) {
    pushConfigCheck(items, 'promptFile', 'ok', `promptFile: ${config.promptFile}`);
  } else {
    pushConfigCheck(items, 'promptFile', 'error', `promptFile が見つかりません: ${config.promptFile}`);
  }

  if (config.mode === 'demo') {
    pushConfigCheck(items, 'agentCommand', 'ok', 'デモモードのため agentCommand は不要です');
  } else if (config.agentCommand.trim()) {
    pushConfigCheck(items, 'agentCommand', 'ok', `agentCommand: ${config.agentCommand}`);
  } else {
    pushConfigCheck(items, 'agentCommand', 'error', '通常実行では RALPH_AGENT_COMMAND が必要です');
  }

  if (!config.taskCatalogFile) {
    pushConfigCheck(items, 'taskCatalog', 'warning', 'task catalog は未設定です。空の Task board から始まります');
  } else if (existsSync(config.taskCatalogFile)) {
    pushConfigCheck(items, 'taskCatalog', 'ok', `task catalog: ${config.taskCatalogFile}`);
  } else {
    pushConfigCheck(items, 'taskCatalog', 'error', `task catalog が見つかりません: ${config.taskCatalogFile}`);
  }

  if (config.panelHost.trim()) {
    pushConfigCheck(items, 'panelHost', 'ok', `panel: http://${config.panelHost}:${config.panelPort}`);
  } else {
    pushConfigCheck(items, 'panelHost', 'error', 'RALPH_PANEL_HOST が空です');
  }

  if (config.panelPort >= 1 && config.panelPort <= 65535) {
    pushConfigCheck(items, 'panelPort', 'ok', `panelPort: ${config.panelPort}`);
  } else {
    pushConfigCheck(items, 'panelPort', 'error', `RALPH_PANEL_PORT が不正です: ${config.panelPort}`);
  }

  if ((config.panelUsername.trim() && !config.panelPassword.trim()) || (!config.panelUsername.trim() && config.panelPassword.trim())) {
    pushConfigCheck(items, 'panelAuth', 'warning', 'panel Basic 認証は username と password を両方設定したときだけ有効です');
  } else if (config.panelUsername.trim() && config.panelPassword.trim()) {
    pushConfigCheck(items, 'panelAuth', 'ok', 'panel Basic 認証は有効です');
  } else {
    pushConfigCheck(items, 'panelAuth', 'warning', 'panel Basic 認証は無効です');
  }

  if (config.allowRuntimeAgentCommandOverride) {
    pushConfigCheck(items, 'runtimeAgentCommand', 'warning', 'web / Discord から agentCommand を更新できます');
    if (!config.panelUsername.trim() || !config.panelPassword.trim()) {
      pushConfigCheck(items, 'runtimeAgentCommandPanelRisk', 'warning', 'runtime agentCommand 変更を許可するなら panel Basic 認証を推奨します');
    }
    if (config.discordEnabled && config.discordAllowedUserIds.length === 0) {
      pushConfigCheck(items, 'runtimeAgentCommandDiscordRisk', 'warning', 'runtime agentCommand 変更を許可するなら Discord の許可ユーザー制限を推奨します');
    }
  } else {
    pushConfigCheck(items, 'runtimeAgentCommand', 'ok', 'agentCommand は起動時設定に固定され、web / Discord からは変更できません');
  }

  if (!config.discordEnabled) {
    pushConfigCheck(items, 'discord', 'warning', 'Discord 連携は無効です。Web panel のみで動作します');
  } else {
    pushConfigCheck(items, 'discord', 'ok', 'Discord token が設定されています');
    if (!config.discordApplicationId.trim()) {
      pushConfigCheck(items, 'discordApplicationId', 'warning', 'RALPH_DISCORD_APPLICATION_ID が空です');
    } else {
      pushConfigCheck(items, 'discordApplicationId', 'ok', `discord application: ${config.discordApplicationId}`);
    }

    if (!config.discordNotifyChannelId.trim() && !config.discordDmUserId.trim()) {
      pushConfigCheck(items, 'discordTarget', 'warning', '通知先の channel または DM user が未設定です');
    } else {
      pushConfigCheck(items, 'discordTarget', 'ok', 'Discord 通知先が設定されています');
    }
  }

  const summary = items.reduce(
    (accumulator, item) => {
      accumulator[item.level] += 1;
      return accumulator;
    },
    { ok: 0, warning: 0, error: 0 },
  );

  return {
    ok: summary.error === 0,
    items,
    summary,
  };
}
