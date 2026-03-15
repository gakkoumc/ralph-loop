import { existsSync, readFileSync } from 'node:fs';

import { buildOrchestrationSnapshot } from '../orchestration/model.ts';
import type { AppConfig } from '../config.ts';
import { parseStructuredMarkers } from '../parser/markers.ts';
import { composePromptWithInjections } from '../prompt/composer.ts';
import { createEventId, createRunId, nextSequentialId } from '../shared/id.ts';
import { nowIso } from '../shared/time.ts';
import type {
  AnswerRecord,
  DashboardData,
  EventRecord,
  MarkerMatch,
  PromptInjectionItem,
  QuestionRecord,
  RuntimeSettings,
  RunStatus,
  RunMode,
  StoredTaskStatus,
  TaskBoardItem,
  TaskRecord,
} from '../shared/types.ts';
import { FileStateStore } from '../state/store.ts';
import { loadTaskSeeds } from '../tasks/catalog.ts';
import { parseTasksFromSpecText, type TaskImportPreview } from '../tasks/importer.ts';

export interface ActionActor {
  source: string;
}

export interface RuntimeSettingsInput {
  taskName?: string;
  agentCommand?: string;
  promptFile?: string;
  promptBody?: string;
  maxIterations?: number;
  idleSeconds?: number;
  mode?: RunMode;
}

export interface TaskDraftInput {
  title?: string;
  summary?: string;
  acceptanceCriteria?: string[];
}

interface ParsedTaskMarker {
  id: string;
  title: string;
  status: StoredTaskStatus;
}

function orderTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((left, right) => {
    const orderDelta = left.sortIndex - right.sortIndex;
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

function resequenceTasks(tasks: TaskRecord[]): void {
  tasks.forEach((task, index) => {
    task.sortIndex = index + 1;
  });
}

function normalizeTaskStatus(value?: string): StoredTaskStatus {
  if (value === 'completed' || value === 'done') {
    return 'completed';
  }

  if (value === 'blocked') {
    return 'blocked';
  }

  return 'pending';
}

function parseTaskMarker(content: string): ParsedTaskMarker | null {
  const parts = content
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    return {
      id: parts[0],
      title: parts[0],
      status: 'pending',
    };
  }

  if (parts.length === 2) {
    return {
      id: parts[0],
      title: parts[1],
      status: 'pending',
    };
  }

  return {
    id: parts[0],
    status: normalizeTaskStatus(parts[1].toLowerCase()),
    title: parts.slice(2).join(' | '),
  };
}

function renderOrchestrationSummary(
  taskBoard: DashboardData['taskBoard'],
  maxIntegration: number,
): string {
  const unfinished = taskBoard.filter((task) => task.displayStatus !== 'completed');
  const active = unfinished.filter((task) => task.displayStatus === 'active');
  const queued = unfinished.filter((task) => task.displayStatus === 'queued');
  const currentTask = active[0];
  const nextTask = queued[0];

  const sections = [
    '現在の orchestration snapshot:',
    `- MaxIntegration: ${maxIntegration}`,
    `- 進行中Task: ${active.length}`,
    `- 待機Task: ${queued.length}`,
  ];

  if (currentTask) {
    sections.push(`- 現在のTask: ${currentTask.id} / ${currentTask.title}`);
  }

  if (nextTask) {
    sections.push(`- 次のTask: ${nextTask.id} / ${nextTask.title}`);
  }

  if (active.length > 0) {
    sections.push('- いま進めるTask:');
    for (const task of active.slice(0, maxIntegration)) {
      sections.push(`  - ${task.id}: ${task.title}`);
    }
  }

  if (queued.length > 0) {
    sections.push('- 次に進めるTask:');
    for (const task of queued.slice(0, maxIntegration)) {
      sections.push(`  - ${task.id}: ${task.title}`);
    }
  }

  return sections.join('\n');
}

export class RunActions {
  readonly store: FileStateStore;
  readonly config: AppConfig;

  constructor(store: FileStateStore, config: AppConfig) {
    this.store = store;
    this.config = config;
  }

  async getDashboardData(): Promise<DashboardData> {
    await this.importLocalInbox();

    const status = this.refreshStatusCounters();
    const settings = this.getRuntimeSettings();
    const questions = this.store.readQuestions();
    const answers = this.store.readAnswers();
    const pendingQuestions = questions.filter((question) => question.status === 'pending');
    const answeredQuestions = questions
      .filter((question) => question.status === 'answered')
      .map((question) => ({
        ...question,
        answer: answers.find((answer) => answer.id === question.answerId),
      }));
    const blockers = this.store.readBlockers().slice(-20).reverse();
    const promptInjectionQueue = this.listPromptInjectionQueue();
    const orchestration = buildOrchestrationSnapshot({
      status,
      tasks: this.synchronizeTaskCatalog(),
      pendingQuestions,
      blockers,
      promptInjectionQueue,
    });
    const currentTask = this.findCurrentTask(orchestration.taskBoard);
    const nextTask = this.findNextTask(orchestration.taskBoard);

    return {
      status,
      settings,
      capabilities: {
        canEditAgentCommand: this.canOverrideAgentCommand({ source: 'web' }),
      },
      currentTask,
      nextTask,
      pendingQuestions,
      answeredQuestions,
      blockers,
      promptInjectionQueue,
      recentEvents: (await this.store.listRecentEvents(40)).reverse(),
      agentLogTail: (await this.store.readAgentOutputTail(80)).filter(Boolean),
      taskBoard: orchestration.taskBoard,
      agentLanes: orchestration.agentLanes,
      thinkingFrames: orchestration.thinkingFrames,
    };
  }

  getStatus(): RunStatus {
    return this.refreshStatusCounters();
  }

  getRuntimeSettings(): RuntimeSettings {
    const settings = this.store.readSettings();
    this.applyRuntimeSettings(settings);
    return settings;
  }

  async updateRuntimeSettings(
    input: RuntimeSettingsInput,
    actor: ActionActor,
  ): Promise<RuntimeSettings> {
    const current = this.store.readSettings();
    const currentAgentCommand = current.agentCommand.trim();
    const nextTaskName = input.taskName?.trim();
    const nextAgentCommand = input.agentCommand?.trim();
    const nextPromptFile = input.promptFile?.trim();
    const wantsAgentCommandChange =
      nextAgentCommand !== undefined && nextAgentCommand !== currentAgentCommand;

    if (wantsAgentCommandChange && !this.canOverrideAgentCommand(actor)) {
      throw new Error('agentCommand は起動時設定に固定されています。CLI または環境変数で変更してください');
    }

    const next: RuntimeSettings = {
      ...current,
      taskName: nextTaskName ? nextTaskName : current.taskName,
      agentCommand: nextAgentCommand ? nextAgentCommand : current.agentCommand,
      promptFile: nextPromptFile ? nextPromptFile : current.promptFile,
      promptBody: input.promptBody ?? current.promptBody,
      maxIterations:
        input.maxIterations && input.maxIterations > 0 ? input.maxIterations : current.maxIterations,
      idleSeconds:
        input.idleSeconds && input.idleSeconds > 0 ? input.idleSeconds : current.idleSeconds,
      mode: input.mode ?? current.mode,
      updatedAt: nowIso(),
      updatedBy: actor.source,
    };

    this.store.writeSettings(next);
    this.applyRuntimeSettings(next);

    const status = this.store.readStatus();
    status.task = next.taskName;
    status.maxIterations = next.maxIterations;
    status.agentCommand = next.agentCommand;
    status.mode = next.mode;
    status.promptFile = next.promptBody.trim() ? '[画面またはDiscordからの prompt 上書き]' : next.promptFile;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);

    await this.appendEvent('settings.updated', 'info', `${actor.source} が実行設定を更新しました`, {
      source: actor.source,
      maxIterations: next.maxIterations,
      mode: next.mode,
    });

    this.refreshStatusCounters();
    return next;
  }

  async createTask(input: TaskDraftInput, actor: ActionActor): Promise<TaskRecord> {
    const tasks = this.synchronizeTaskCatalog();
    const record = this.buildTaskRecord(tasks, input, actor);
    tasks.push(record);
    this.store.writeTasks(tasks);
    await this.appendEvent('task.created', 'info', `${record.id}: ${record.title}`, {
      source: actor.source,
      taskId: record.id,
    });
    this.refreshStatusCounters();
    return record;
  }

  async previewTaskImport(specText: string): Promise<TaskImportPreview> {
    return parseTasksFromSpecText(specText);
  }

  async importTasksFromSpec(
    specText: string,
    actor: ActionActor,
  ): Promise<{ preview: TaskImportPreview; tasks: TaskRecord[] }> {
    const preview = parseTasksFromSpecText(specText);
    if (preview.tasks.length === 0) {
      throw new Error('Task に分解できる項目が見つかりませんでした');
    }

    const tasks = this.synchronizeTaskCatalog();
    const created = preview.tasks.map((draft) => {
      const record = this.buildTaskRecord(tasks, draft, actor);
      tasks.push(record);
      return record;
    });

    this.store.writeTasks(tasks);

    const status = this.store.readStatus();
    status.currentStatusText = `${created.length} 件のTaskを仕様書から追加しました`;
    status.thinkingText = status.currentStatusText;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);

    await this.appendEvent(
      'task.imported',
      'info',
      `${created.length} 件のTaskを仕様書から追加しました`,
      {
        source: actor.source,
        count: created.length,
        format: preview.format,
        truncated: preview.truncated,
      },
    );

    this.refreshStatusCounters();
    return { preview, tasks: created };
  }

  async updateTask(
    taskId: string,
    input: TaskDraftInput,
    actor: ActionActor,
  ): Promise<TaskRecord | null> {
    const tasks = this.synchronizeTaskCatalog();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return null;
    }

    const nextTitle = input.title?.trim();
    const nextSummary = input.summary?.trim();
    const seed = loadTaskSeeds(this.config).find((item) => item.id === taskId);
    if (nextTitle) {
      task.title = nextTitle;
      task.titleOverride = seed ? (nextTitle === seed.title ? undefined : nextTitle) : undefined;
    }
    if (nextSummary !== undefined) {
      const summary = nextSummary || task.title;
      task.summary = summary;
      task.summaryOverride = seed ? (summary === seed.summary ? undefined : summary) : undefined;
    }
    task.updatedAt = nowIso();
    task.source = actor.source;

    this.store.writeTasks(tasks);
    await this.appendEvent('task.updated', 'info', `${task.id}: ${task.title}`, {
      source: actor.source,
      taskId: task.id,
    });
    this.refreshStatusCounters();
    return task;
  }

  async completeTask(taskId: string, actor: ActionActor): Promise<TaskRecord | null> {
    const tasks = this.synchronizeTaskCatalog();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return null;
    }

    task.status = 'completed';
    task.completedAt = nowIso();
    task.updatedAt = task.completedAt;
    task.source = actor.source;
    this.store.writeTasks(tasks);

    const nextTask = this.findNextTask(buildOrchestrationSnapshot({
      status: this.store.readStatus(),
      tasks,
      pendingQuestions: this.listPendingQuestions(),
      blockers: this.store.readBlockers(),
      promptInjectionQueue: this.listPromptInjectionQueue(),
    }).taskBoard);

    const status = this.store.readStatus();
    status.currentStatusText = nextTask
      ? `${task.id} を完了しました。次は ${nextTask.id} に進みます`
      : `${task.id} を完了しました。残りのTaskはありません`;
    status.thinkingText = status.currentStatusText;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);

    await this.appendEvent('task.completed', 'info', `${task.id}: ${task.title}`, {
      source: actor.source,
      taskId: task.id,
    });
    this.refreshStatusCounters();
    return task;
  }

  async reopenTask(taskId: string, actor: ActionActor): Promise<TaskRecord | null> {
    const tasks = this.synchronizeTaskCatalog();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return null;
    }

    task.status = 'pending';
    task.completedAt = undefined;
    task.updatedAt = nowIso();
    task.source = actor.source;
    this.store.writeTasks(tasks);
    await this.appendEvent('task.reopened', 'warning', `${task.id}: ${task.title}`, {
      source: actor.source,
      taskId: task.id,
    });
    this.refreshStatusCounters();
    return task;
  }

  async moveTask(taskId: string, position: 'front' | 'back', actor: ActionActor): Promise<TaskRecord | null> {
    const tasks = this.synchronizeTaskCatalog();
    const ordered = orderTasks(tasks);
    const taskIndex = ordered.findIndex((item) => item.id === taskId);
    if (taskIndex === -1) {
      return null;
    }

    const [task] = ordered.splice(taskIndex, 1);
    ordered.splice(position === 'front' ? 0 : ordered.length, 0, task);
    resequenceTasks(ordered);
    task.updatedAt = nowIso();
    task.source = actor.source;
    this.store.writeTasks(ordered);

    const directionLabel = position === 'front' ? '最優先へ移動しました' : '後ろへ回しました';
    await this.appendEvent('task.reordered', 'info', `${task.id}: ${directionLabel}`, {
      source: actor.source,
      taskId: task.id,
      position,
    });

    const status = this.store.readStatus();
    status.currentStatusText =
      position === 'front'
        ? `${task.id} を最優先にしました`
        : `${task.id} を後ろへ回しました`;
    status.thinkingText = status.currentStatusText;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    this.refreshStatusCounters();
    return task;
  }

  async requestRunStart(
    actor: ActionActor,
  ): Promise<{ started: boolean; status: RunStatus; message: string }> {
    const current = this.store.readStatus();
    if (current.phase === 'queued') {
      return {
        started: false,
        status: this.refreshStatusCounters(),
        message: 'run はすでに待機列にあります',
      };
    }

    if (['starting', 'running', 'pause_requested', 'paused'].includes(current.lifecycle)) {
      return {
        started: false,
        status: this.refreshStatusCounters(),
        message: 'run はすでに実行中です',
      };
    }

    const settings = this.getRuntimeSettings();
    const settingsError = this.validateRuntimeSettings(settings);
    if (settingsError) {
      await this.appendEvent('run.request.rejected', 'warning', settingsError, { source: actor.source });
      return {
        started: false,
        status: this.refreshStatusCounters(),
        message: settingsError,
      };
    }

    this.store.clearRunArtifacts();

    const status = this.store.readStatus();
    status.runId = '';
    status.task = settings.taskName;
    status.phase = 'queued';
    status.lifecycle = 'idle';
    status.control = 'running';
    status.iteration = 0;
    status.maxIterations = settings.maxIterations;
    status.currentStatusText = `${actor.source} が start を要求しました`;
    status.lastQuestionId = undefined;
    status.lastQuestionText = undefined;
    status.lastBlockerId = undefined;
    status.lastBlockerText = undefined;
    status.pendingQuestionCount = 0;
    status.answeredQuestionCount = 0;
    status.pendingInjectionCount = 0;
    status.blockerCount = 0;
    status.activeTaskCount = 0;
    status.completedTaskCount = 0;
    status.queuedTaskCount = 0;
    status.startedAt = undefined;
    status.finishedAt = undefined;
    status.lastPromptPreview = undefined;
    status.lastError = undefined;
    status.updatedAt = nowIso();
    status.agentCommand = settings.agentCommand;
    status.mode = settings.mode;
    status.promptFile = settings.promptBody.trim() ? '[画面またはDiscordからの prompt 上書き]' : settings.promptFile;
    status.thinkingText = 'Ralph は待機中です。最初のTaskから着手できます。';
    this.store.writeStatus(status);

    this.synchronizeTaskCatalog();
    await this.appendEvent('run.requested', 'info', `${actor.source} が run 開始を要求しました`, {
      source: actor.source,
    });

    return {
      started: true,
      status: this.refreshStatusCounters(),
      message: 'run 開始を待機列に追加しました',
    };
  }

  async recoverInterruptedRun(actor: ActionActor = { source: 'system' }): Promise<RunStatus | null> {
    const status = this.store.readStatus();
    if (!['starting', 'running', 'pause_requested', 'paused'].includes(status.lifecycle)) {
      return null;
    }

    status.lifecycle = 'failed';
    status.phase = 'interrupted';
    status.control = 'running';
    status.currentStatusText = '前回の run は service 再起動で中断されました';
    status.thinkingText = '前回の中断状態を回復しました。次の run を受け付けできます。';
    status.finishedAt = nowIso();
    status.updatedAt = status.finishedAt;
    this.store.writeStatus(status);
    await this.appendEvent('run.recovered', 'warning', `${actor.source} が古い実行状態を回復しました`, {
      source: actor.source,
    });
    return this.refreshStatusCounters();
  }

  async pauseRun(actor: ActionActor): Promise<RunStatus> {
    const status = this.store.readStatus();
    status.control = 'paused';
    status.lifecycle = status.lifecycle === 'running' ? 'pause_requested' : 'paused';
    status.phase = 'paused';
    status.thinkingText = '一時停止中です。Task と状態は保持しています。';
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    await this.appendEvent('run.pause', 'warning', `${actor.source} が pause を要求しました`);
    return this.refreshStatusCounters();
  }

  async resumeRun(actor: ActionActor): Promise<RunStatus> {
    const status = this.store.readStatus();
    status.control = 'running';
    status.lifecycle = status.lifecycle === 'paused' ? 'running' : status.lifecycle;
    status.phase = 'running';
    status.thinkingText = '再開しました。現在のTaskから続けます。';
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    await this.appendEvent('run.resume', 'info', `${actor.source} が resume しました`);
    return this.refreshStatusCounters();
  }

  async abortRun(actor: ActionActor): Promise<RunStatus> {
    const status = this.store.readStatus();
    status.control = 'abort_requested';
    status.lifecycle = 'aborted';
    status.phase = 'aborted';
    status.thinkingText = '中断要求を受け取りました。現在のターンを安全に閉じます。';
    status.finishedAt = nowIso();
    status.updatedAt = status.finishedAt;
    this.store.writeStatus(status);
    await this.appendEvent('run.abort', 'error', `${actor.source} が中断を要求しました`);
    return this.refreshStatusCounters();
  }

  async submitAnswer(questionId: string, answer: string, actor: ActionActor): Promise<AnswerRecord> {
    const questions = this.store.readQuestions();
    const answers = this.store.readAnswers();
    const timestamp = nowIso();
    const answerId = nextSequentialId(
      'A',
      answers.map((item) => item.id),
    );

    const record: AnswerRecord = {
      id: answerId,
      questionId,
      answer,
      createdAt: timestamp,
      source: actor.source,
    };

    answers.push(record);
    this.store.writeAnswers(answers);

    const question = questions.find((item) => item.id === questionId);
    if (question) {
      question.status = 'answered';
      question.answerId = record.id;
      question.answeredAt = timestamp;
      this.store.writeQuestions(questions);
    }

    await this.appendEvent(
      'question.answered',
      'info',
      `${questionId} に回答が追加されました`,
      { source: actor.source, answerId },
    );
    this.refreshStatusCounters();

    return record;
  }

  async enqueueManualNote(note: string, actor: ActionActor): Promise<void> {
    const notes = this.store.readManualNotes();
    const noteId = nextSequentialId(
      'N',
      notes.map((item) => item.id),
    );

    notes.push({
      id: noteId,
      note,
      createdAt: nowIso(),
      source: actor.source,
    });
    this.store.writeManualNotes(notes);
    await this.appendEvent('note.enqueued', 'info', `${actor.source} が手動ノートを投入しました`, {
      noteId,
    });
    this.refreshStatusCounters();
  }

  listPendingQuestions(): QuestionRecord[] {
    return this.store.readQuestions().filter((question) => question.status === 'pending');
  }

  listAnsweredQuestions(): Array<QuestionRecord & { answer?: AnswerRecord }> {
    const answers = this.store.readAnswers();
    return this.store
      .readQuestions()
      .filter((question) => question.status === 'answered')
      .map((question) => ({
        ...question,
        answer: answers.find((answer) => answer.id === question.answerId),
      }));
  }

  listPromptInjectionQueue(): PromptInjectionItem[] {
    const answers = this.store
      .readAnswers()
      .filter((answer) => !answer.injectedAt)
      .map((answer) => ({
        id: answer.id,
        kind: 'answer' as const,
        label: answer.questionId,
        text: answer.answer,
        createdAt: answer.createdAt,
      }));

    const notes = this.store
      .readManualNotes()
      .filter((note) => !note.injectedAt)
      .map((note) => ({
        id: note.id,
        kind: 'note' as const,
        label: note.id,
        text: note.note,
        createdAt: note.createdAt,
      }));

    return [...answers, ...notes].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async preparePromptForNextTurn(): Promise<string> {
    await this.importLocalInbox();

    const settings = this.getRuntimeSettings();
    const basePrompt = settings.promptBody.trim()
      ? settings.promptBody
      : readFileSync(settings.promptFile, 'utf8');
    const answers = this.store.readAnswers();
    const notes = this.store.readManualNotes();
    const queuedAnswers = answers.filter((answer) => !answer.injectedAt);
    const queuedNotes = notes.filter((note) => !note.injectedAt);
    const dashboard = await this.getDashboardData();
    const orchestrationSection = renderOrchestrationSummary(
      dashboard.taskBoard,
      dashboard.status.maxIntegration,
    );
    const result = composePromptWithInjections(
      basePrompt,
      queuedAnswers,
      queuedNotes,
      [orchestrationSection],
    );

    if (result.injectedAnswerIds.length > 0) {
      const injectedAt = nowIso();
      for (const answer of answers) {
        if (result.injectedAnswerIds.includes(answer.id)) {
          answer.injectedAt = injectedAt;
        }
      }
      this.store.writeAnswers(answers);
    }

    if (result.injectedNoteIds.length > 0) {
      const injectedAt = nowIso();
      for (const note of notes) {
        if (result.injectedNoteIds.includes(note.id)) {
          note.injectedAt = injectedAt;
        }
      }
      this.store.writeManualNotes(notes);
    }

    const status = this.refreshStatusCounters();
    status.lastPromptPreview = result.appendedSections.join('\n\n').slice(0, 1000);
    status.updatedAt = nowIso();
    this.store.writeStatus(status);

    return result.prompt;
  }

  async handleAgentOutput(output: string): Promise<{ done: boolean; markers: MarkerMatch[] }> {
    const markers = parseStructuredMarkers(output);
    let done = false;

    for (const marker of markers) {
      if (marker.kind === 'STATUS') {
        await this.recordAgentStatus(marker.content);
      }

      if (marker.kind === 'QUESTION') {
        await this.recordQuestion(marker.content);
      }

      if (marker.kind === 'BLOCKER') {
        await this.recordBlocker(marker.content);
      }

      if (marker.kind === 'THINKING') {
        await this.recordThinking(marker.content);
      }

      if (marker.kind === 'TASK') {
        await this.recordTaskSignal(marker.content);
      }

      if (marker.kind === 'DONE') {
        done = true;
        await this.markDone(marker.content || 'DONE マーカーを受信しました');
      }
    }

    if (markers.length === 0) {
      await this.appendEvent('agent.output', 'info', 'structured marker がない出力を受信しました');
    }

    return { done, markers };
  }

  async recordAgentStatus(message: string): Promise<void> {
    const status = this.store.readStatus();
    status.currentStatusText = message;
    status.thinkingText = message;
    status.phase = 'running';
    if (status.control === 'running') {
      status.lifecycle = 'running';
    }
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    await this.appendEvent('agent.status', 'info', message);
  }

  async recordThinking(message: string): Promise<void> {
    const status = this.store.readStatus();
    status.thinkingText = message;
    if (!status.currentStatusText) {
      status.currentStatusText = message;
    }
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    await this.appendEvent('agent.thinking', 'info', message);
  }

  async recordQuestion(questionText: string, source: string = 'agent'): Promise<QuestionRecord> {
    const questions = this.store.readQuestions();
    const existingPending = questions.find(
      (question) => question.status === 'pending' && question.text === questionText,
    );
    if (existingPending) {
      return existingPending;
    }

    const questionId = nextSequentialId(
      'Q',
      questions.map((item) => item.id),
    );

    const question: QuestionRecord = {
      id: questionId,
      text: questionText,
      status: 'pending',
      createdAt: nowIso(),
      source,
    };

    questions.push(question);
    this.store.writeQuestions(questions);

    const status = this.store.readStatus();
    status.lastQuestionId = question.id;
    status.lastQuestionText = question.text;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);

    await this.appendEvent('question.created', 'warning', `${question.id}: ${question.text}`, {
      questionId: question.id,
    });
    this.refreshStatusCounters();

    return question;
  }

  async recordBlocker(blockerText: string, source: string = 'agent'): Promise<void> {
    const blockers = this.store.readBlockers();
    const blockerId = nextSequentialId(
      'B',
      blockers.map((item) => item.id),
    );

    blockers.push({
      id: blockerId,
      text: blockerText,
      createdAt: nowIso(),
      source,
    });
    this.store.writeBlockers(blockers);

    const status = this.store.readStatus();
    status.lastBlockerId = blockerId;
    status.lastBlockerText = blockerText;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);

    await this.appendEvent('blocker.created', 'error', `${blockerId}: ${blockerText}`, {
      blockerId,
    });
    this.refreshStatusCounters();
  }

  async recordTaskSignal(content: string, source: string = 'agent'): Promise<void> {
    const parsed = parseTaskMarker(content);
    if (!parsed) {
      await this.appendEvent('task.invalid', 'warning', `task marker を解釈できませんでした: ${content}`);
      return;
    }

    const tasks = this.synchronizeTaskCatalog();
    const timestamp = nowIso();
    const existing = tasks.find((task) => task.id === parsed.id);

    if (existing) {
      existing.title = parsed.title || existing.title;
      existing.summary = parsed.title || existing.summary;
      existing.status = parsed.status;
      existing.updatedAt = timestamp;
      existing.completedAt = parsed.status === 'completed' ? timestamp : undefined;
      existing.source = source;
    } else {
      tasks.push({
        id: parsed.id,
        title: parsed.title,
        summary: parsed.title,
        priority: 'medium',
        sortIndex: tasks.reduce((max, task) => Math.max(max, task.sortIndex), 0) + 1,
        status: parsed.status,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: parsed.status === 'completed' ? timestamp : undefined,
        source,
        acceptanceCriteria: [],
      });
    }

    this.store.writeTasks(tasks);
    await this.appendEvent(
      'task.updated',
      'info',
      `${parsed.id}: ${parsed.status} / ${parsed.title}`,
      { taskId: parsed.id, taskStatus: parsed.status },
    );
    this.refreshStatusCounters();
  }

  async markDone(message: string): Promise<void> {
    const currentTask = this.findCurrentTask(
      buildOrchestrationSnapshot({
        status: this.store.readStatus(),
        tasks: this.synchronizeTaskCatalog(),
        pendingQuestions: this.listPendingQuestions(),
        blockers: this.store.readBlockers(),
        promptInjectionQueue: this.listPromptInjectionQueue(),
      }).taskBoard,
    );
    if (currentTask) {
      await this.completeTask(currentTask.id, { source: 'agent' });
    }

    const status = this.store.readStatus();
    status.lifecycle = 'completed';
    status.control = 'running';
    status.phase = 'completed';
    status.currentStatusText = message;
    status.thinkingText = message;
    status.finishedAt = nowIso();
    status.updatedAt = status.finishedAt;
    this.store.writeStatus(status);
    await this.appendEvent('run.completed', 'info', message);
  }

  async markRunStarted(): Promise<RunStatus> {
    const settings = this.getRuntimeSettings();
    const status = this.store.readStatus();
    status.runId = createRunId();
    status.task = settings.taskName;
    status.phase = 'starting';
    status.lifecycle = 'starting';
    status.control = 'running';
    status.startedAt = nowIso();
    status.finishedAt = undefined;
    status.updatedAt = nowIso();
    status.agentCommand = settings.agentCommand;
    status.mode = settings.mode;
    status.promptFile = settings.promptBody.trim() ? '[画面またはDiscordからの prompt 上書き]' : settings.promptFile;
    status.maxIterations = settings.maxIterations;
    status.thinkingText = 'Task の流れを確認し、最初のTaskに担当を割り当てています。';
    this.store.writeStatus(status);
    this.synchronizeTaskCatalog();
    await this.appendEvent('run.started', 'info', 'supervisor を開始しました', {
      mode: this.config.mode,
    });
    return this.refreshStatusCounters();
  }

  async updateIteration(iteration: number): Promise<RunStatus> {
    const status = this.store.readStatus();
    status.iteration = iteration;
    status.phase = status.control === 'paused' ? 'paused' : 'running';
    status.lifecycle = status.control === 'paused' ? 'paused' : 'running';
    status.thinkingText = `${iteration} 回目の思考を進めています。現在のTaskを中心に回しています。`;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    return this.refreshStatusCounters();
  }

  async markMaxIterationsReached(): Promise<void> {
    const status = this.store.readStatus();
    status.lifecycle = 'failed';
    status.phase = 'max_iterations_reached';
    status.currentStatusText = '最大反復回数に到達しました';
    status.thinkingText = '思考回数の上限に到達しました。続きは次の run で進めてください。';
    status.finishedAt = nowIso();
    status.updatedAt = status.finishedAt;
    this.store.writeStatus(status);
    await this.appendEvent('run.max_iterations', 'warning', '最大反復回数に到達しました');
  }

  async markRuntimeError(error: unknown): Promise<void> {
    const status = this.store.readStatus();
    status.lifecycle = status.control === 'abort_requested' ? 'aborted' : 'failed';
    status.phase = status.lifecycle;
    status.lastError = error instanceof Error ? error.stack ?? error.message : String(error);
    status.thinkingText = '実行中に障害が発生しました。状態を確認して次の run を準備してください。';
    status.finishedAt = nowIso();
    status.updatedAt = status.finishedAt;
    this.store.writeStatus(status);
    await this.appendEvent('run.error', 'error', 'supervisor でエラーが発生しました', {
      error: status.lastError,
    });
  }

  async appendAgentOutput(output: string, iteration: number): Promise<void> {
    const header = `\n=== iteration ${iteration} @ ${nowIso()} ===\n`;
    await this.store.appendAgentOutput(`${header}${output.trimEnd()}\n`);
  }

  private async importLocalInbox(): Promise<void> {
    const offsets = this.store.readInboxOffsets();
    const answerLines = await this.store.readAnswerInboxLines();
    const noteLines = await this.store.readNoteInboxLines();

    const newAnswerLines = answerLines
      .slice(offsets.answersLineOffset)
      .map((line) => line.trim())
      .filter(Boolean);
    const newNoteLines = noteLines
      .slice(offsets.notesLineOffset)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of newAnswerLines) {
      try {
        const payload = JSON.parse(line) as { questionId?: string; answer?: string };
        if (payload.questionId && payload.answer) {
          await this.submitAnswer(payload.questionId, payload.answer, { source: 'file' });
        }
      } catch {
        await this.appendEvent('file.answer.invalid', 'warning', `answer-inbox.jsonl の行を読み取れませんでした: ${line}`);
      }
    }

    for (const line of newNoteLines) {
      await this.enqueueManualNote(line, { source: 'file' });
    }

    if (newAnswerLines.length > 0 || newNoteLines.length > 0) {
      this.store.writeInboxOffsets({
        answersLineOffset: answerLines.length,
        notesLineOffset: noteLines.length,
      });
    }
  }

  private synchronizeTaskCatalog(): TaskRecord[] {
    const timestamp = nowIso();
    const existingTasks = this.store.readTasks();
    const seeds = loadTaskSeeds(this.config);

    if (seeds.length === 0) {
      return existingTasks;
    }

    const existingById = new Map(existingTasks.map((task) => [task.id, task]));
    const seedIds = new Set(seeds.map((seed) => seed.id));

    const merged: TaskRecord[] = seeds.map((seed) => {
      const existing = existingById.get(seed.id);
      const nextStatus =
        seed.status === 'completed'
          ? 'completed'
          : existing?.status === 'completed'
            ? 'completed'
            : existing?.status === 'blocked'
            ? 'blocked'
            : 'pending';
      const nextTitle = existing?.titleOverride ?? seed.title;
      const nextSummary = existing?.summaryOverride ?? seed.summary;
      const nextNotes = existing?.notes ?? seed.notes;

      return {
        id: seed.id,
        title: nextTitle,
        summary: nextSummary,
        priority: seed.priority,
        sortIndex: existing?.sortIndex ?? seed.sortIndex,
        status: nextStatus,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt:
          existing &&
          existing.title === nextTitle &&
          existing.summary === nextSummary &&
          existing.notes === nextNotes &&
          existing.status === nextStatus
            ? existing.updatedAt
            : timestamp,
        source: existing?.source ?? seed.source,
        acceptanceCriteria: seed.acceptanceCriteria,
        notes: nextNotes,
        titleOverride: existing?.titleOverride,
        summaryOverride: existing?.summaryOverride,
        completedAt: nextStatus === 'completed' ? existing?.completedAt ?? timestamp : undefined,
      };
    });

    const manualTasks = existingTasks.filter((task) => !seedIds.has(task.id));
    const catalog = [...merged, ...manualTasks];
    this.store.writeTasks(catalog);
    return catalog;
  }

  private buildTaskRecord(tasks: TaskRecord[], input: TaskDraftInput, actor: ActionActor): TaskRecord {
    const title = input.title?.trim();
    if (!title) {
      throw new Error('Task 名を入力してください');
    }

    const nextIndex = tasks.reduce((max, task) => Math.max(max, task.sortIndex), 0) + 1;
    const timestamp = nowIso();
    const taskId = nextSequentialId(
      'T',
      tasks
        .map((task) => task.id)
        .filter((id) => /^T-\d+$/.test(id)),
    );

    return {
      id: taskId,
      title,
      summary: input.summary?.trim() || title,
      priority: 'high',
      sortIndex: nextIndex,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      source: actor.source,
      acceptanceCriteria: (input.acceptanceCriteria ?? []).map((item) => item.trim()).filter(Boolean),
    };
  }

  private applyRuntimeSettings(settings: RuntimeSettings): void {
    this.config.taskName = settings.taskName;
    this.config.agentCommand = settings.agentCommand;
    this.config.promptFile = settings.promptFile;
    this.config.maxIterations = settings.maxIterations;
    this.config.idleSeconds = settings.idleSeconds;
    this.config.mode = settings.mode;
  }

  private canOverrideAgentCommand(actor: ActionActor): boolean {
    return this.config.allowRuntimeAgentCommandOverride || !['web', 'discord'].includes(actor.source);
  }

  private validateRuntimeSettings(settings: RuntimeSettings): string | null {
    if (!settings.taskName.trim()) {
      return 'run を開始する前に taskName を設定してください';
    }

    if (settings.mode === 'command' && !settings.agentCommand.trim()) {
      return '通常実行では agentCommand が必要です';
    }

    if (!settings.promptBody.trim() && !settings.promptFile.trim()) {
      return 'run を開始する前に promptBody または promptFile を設定してください';
    }

    if (!settings.promptBody.trim() && !existsSync(settings.promptFile)) {
      return `promptFile が見つかりません: ${settings.promptFile}`;
    }

    return null;
  }

  private refreshStatusCounters(): RunStatus {
    const status = this.store.readStatus();
    const questions = this.store.readQuestions();
    const pendingQuestions = questions.filter((question) => question.status === 'pending');
    const blockers = this.store.readBlockers();
    const promptInjectionQueue = this.listPromptInjectionQueue();
    const orchestration = buildOrchestrationSnapshot({
      status,
      tasks: this.synchronizeTaskCatalog(),
      pendingQuestions,
      blockers,
      promptInjectionQueue,
    });

    status.pendingQuestionCount = pendingQuestions.length;
    status.answeredQuestionCount = questions.filter((question) => question.status === 'answered').length;
    status.pendingInjectionCount = promptInjectionQueue.length;
    status.blockerCount = blockers.length;
    status.totalTaskCount = orchestration.totalTaskCount;
    status.activeTaskCount = orchestration.activeTaskCount;
    status.completedTaskCount = orchestration.completedTaskCount;
    status.queuedTaskCount = orchestration.queuedTaskCount;
    status.maxIntegration = orchestration.maxIntegration;
    status.thinkingText = status.thinkingText || orchestration.thinkingFrames[0];
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    return status;
  }

  private findCurrentTask(taskBoard: TaskBoardItem[]): TaskBoardItem | undefined {
    return taskBoard.find((task) => task.displayStatus === 'active')
      ?? taskBoard.find((task) => task.displayStatus === 'queued');
  }

  private findNextTask(taskBoard: TaskBoardItem[]): TaskBoardItem | undefined {
    const currentTask = this.findCurrentTask(taskBoard);
    if (!currentTask) {
      return undefined;
    }

    let seenCurrent = false;
    for (const task of taskBoard) {
      if (task.id === currentTask.id) {
        seenCurrent = true;
        continue;
      }

      if (seenCurrent && task.displayStatus !== 'completed') {
        return task;
      }
    }

    return undefined;
  }

  private async appendEvent(
    type: string,
    level: EventRecord['level'],
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.store.appendEvent({
      id: createEventId(),
      timestamp: nowIso(),
      type,
      message,
      level,
      data,
    });
  }
}
