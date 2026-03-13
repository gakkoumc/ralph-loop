import { existsSync, readFileSync } from 'node:fs';

import { buildOrchestrationSnapshot } from '../orchestration/model.ts';
import type { AppConfig } from '../config.ts';
import { parseStructuredMarkers } from '../parser/markers.ts';
import { composePromptWithInjections } from '../prompt/composer.ts';
import { createRunId, nextSequentialId } from '../shared/id.ts';
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
  TaskRecord,
} from '../shared/types.ts';
import { FileStateStore } from '../state/store.ts';
import { loadTaskSeeds, makeSyntheticTask } from '../tasks/catalog.ts';

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

interface ParsedTaskMarker {
  id: string;
  title: string;
  status: StoredTaskStatus;
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

  const sections = [
    '現在の orchestration snapshot:',
    `- MaxIntegration: ${maxIntegration}`,
    `- Active Tasks: ${active.length}`,
    `- Queued Tasks: ${queued.length}`,
  ];

  if (active.length > 0) {
    sections.push('- In-flight:');
    for (const task of active.slice(0, maxIntegration)) {
      sections.push(`  - ${task.id}: ${task.title}`);
    }
  }

  if (queued.length > 0) {
    sections.push('- Next Up:');
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

    return {
      status,
      settings,
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
    const nextTaskName = input.taskName?.trim();
    const nextAgentCommand = input.agentCommand?.trim();
    const nextPromptFile = input.promptFile?.trim();
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
    status.promptFile = next.promptBody.trim() ? '[inline prompt override]' : next.promptFile;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);

    await this.appendEvent('settings.updated', 'info', `${actor.source} が runtime settings を更新しました`, {
      source: actor.source,
      maxIterations: next.maxIterations,
      mode: next.mode,
    });

    this.refreshStatusCounters();
    return next;
  }

  async requestRunStart(
    actor: ActionActor,
  ): Promise<{ started: boolean; status: RunStatus; message: string }> {
    const current = this.store.readStatus();
    if (current.phase === 'queued') {
      return {
        started: false,
        status: this.refreshStatusCounters(),
        message: 'run is already queued',
      };
    }

    if (['starting', 'running', 'pause_requested', 'paused'].includes(current.lifecycle)) {
      return {
        started: false,
        status: this.refreshStatusCounters(),
        message: 'run is already active',
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
    status.promptFile = settings.promptBody.trim() ? '[inline prompt override]' : settings.promptFile;
    status.thinkingText = 'Ralph is standing by and ready to take the first turn.';
    this.store.writeStatus(status);

    this.synchronizeTaskCatalog();
    await this.appendEvent('run.requested', 'info', `${actor.source} が run 開始を要求しました`, {
      source: actor.source,
    });

    return {
      started: true,
      status: this.refreshStatusCounters(),
      message: 'run start queued',
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
    status.thinkingText = 'Recovered from a stale active state. Ralph is ready for the next queued run.';
    status.finishedAt = nowIso();
    status.updatedAt = status.finishedAt;
    this.store.writeStatus(status);
    await this.appendEvent('run.recovered', 'warning', `${actor.source} が stale run state を回復しました`, {
      source: actor.source,
    });
    return this.refreshStatusCounters();
  }

  async pauseRun(actor: ActionActor): Promise<RunStatus> {
    const status = this.store.readStatus();
    status.control = 'paused';
    status.lifecycle = status.lifecycle === 'running' ? 'pause_requested' : 'paused';
    status.phase = 'paused';
    status.thinkingText = 'Run is paused. Ralph keeps the orchestration state intact.';
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
    status.thinkingText = 'Ralph resumed. Active lanes are warming up again.';
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
    status.thinkingText = 'Abort requested. Ralph is collapsing the current turn safely.';
    status.finishedAt = nowIso();
    status.updatedAt = status.finishedAt;
    this.store.writeStatus(status);
    await this.appendEvent('run.abort', 'error', `${actor.source} が abort を要求しました`);
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
        await this.markDone(marker.content || 'DONE marker received');
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
      existing.source = source;
    } else {
      tasks.push({
        id: parsed.id,
        title: parsed.title,
        summary: parsed.title,
        priority: 'medium',
        status: parsed.status,
        createdAt: timestamp,
        updatedAt: timestamp,
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
    status.promptFile = settings.promptBody.trim() ? '[inline prompt override]' : settings.promptFile;
    status.maxIterations = settings.maxIterations;
    status.thinkingText = 'Ralph is mapping the task graph and assigning worker lanes.';
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
    status.thinkingText = `Iteration ${iteration} is in flight. Ralph is rotating active lanes.`;
    status.updatedAt = nowIso();
    this.store.writeStatus(status);
    return this.refreshStatusCounters();
  }

  async markMaxIterationsReached(): Promise<void> {
    const status = this.store.readStatus();
    status.lifecycle = 'failed';
    status.phase = 'max_iterations_reached';
    status.currentStatusText = '最大反復回数に到達しました';
    status.thinkingText = 'Iteration ceiling reached before the task graph fully converged.';
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
    status.thinkingText = 'Ralph hit a runtime fault while coordinating the run.';
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
      if (existingTasks.length > 0) {
        return existingTasks;
      }

      const synthetic = makeSyntheticTask(this.store.readStatus().task || this.config.taskName, timestamp);
      this.store.writeTasks([synthetic]);
      return [synthetic];
    }

    const existingById = new Map(existingTasks.map((task) => [task.id, task]));
    const seedIds = new Set(seeds.map((seed) => seed.id));

    const merged: TaskRecord[] = seeds.map((seed) => {
      const existing = existingById.get(seed.id);
      const nextStatus =
        seed.status === 'completed'
          ? 'completed'
          : existing?.status === 'blocked'
            ? 'blocked'
            : 'pending';

      return {
        id: seed.id,
        title: seed.title,
        summary: seed.summary,
        priority: seed.priority,
        status: nextStatus,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt:
          existing &&
          existing.title === seed.title &&
          existing.summary === seed.summary &&
          existing.notes === seed.notes &&
          existing.status === nextStatus
            ? existing.updatedAt
            : timestamp,
        source: seed.source,
        acceptanceCriteria: seed.acceptanceCriteria,
        notes: seed.notes ?? existing?.notes,
      };
    });

    const manualTasks = existingTasks.filter((task) => !seedIds.has(task.id));
    const catalog = [...merged, ...manualTasks];
    this.store.writeTasks(catalog);
    return catalog;
  }

  private applyRuntimeSettings(settings: RuntimeSettings): void {
    this.config.taskName = settings.taskName;
    this.config.agentCommand = settings.agentCommand;
    this.config.promptFile = settings.promptFile;
    this.config.maxIterations = settings.maxIterations;
    this.config.idleSeconds = settings.idleSeconds;
    this.config.mode = settings.mode;
  }

  private validateRuntimeSettings(settings: RuntimeSettings): string | null {
    if (!settings.taskName.trim()) {
      return 'taskName is required before starting a run';
    }

    if (settings.mode === 'command' && !settings.agentCommand.trim()) {
      return 'agentCommand is required in command mode';
    }

    if (!settings.promptBody.trim() && !settings.promptFile.trim()) {
      return 'promptBody or promptFile is required before starting a run';
    }

    if (!settings.promptBody.trim() && !existsSync(settings.promptFile)) {
      return `promptFile not found: ${settings.promptFile}`;
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

  private async appendEvent(
    type: string,
    level: EventRecord['level'],
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const recentEvents = await this.store.listRecentEvents(500);
    const eventId = nextSequentialId(
      'E',
      recentEvents.map((event) => event.id),
    );

    await this.store.appendEvent({
      id: eventId,
      timestamp: nowIso(),
      type,
      message,
      level,
      data,
    });
  }
}
