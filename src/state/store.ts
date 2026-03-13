import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppConfig } from '../config.ts';
import { nowIso } from '../shared/time.ts';
import type {
  AnswerRecord,
  BlockerRecord,
  EventRecord,
  ManualNoteRecord,
  QuestionRecord,
  RunStatus,
} from '../shared/types.ts';

interface InboxOffsets {
  answersLineOffset: number;
  notesLineOffset: number;
}

function defaultStatus(config: AppConfig): RunStatus {
  return {
    runId: '',
    task: config.taskName,
    phase: 'idle',
    lifecycle: 'idle',
    control: 'running',
    iteration: 0,
    maxIterations: config.maxIterations,
    currentStatusText: '',
    pendingQuestionCount: 0,
    answeredQuestionCount: 0,
    pendingInjectionCount: 0,
    blockerCount: 0,
    updatedAt: nowIso(),
    agentCommand: config.agentCommand,
    mode: config.mode,
    promptFile: config.promptFile,
  };
}

export class FileStateStore {
  private readonly stateDir: string;
  private readonly logDir: string;
  private readonly config: AppConfig;

  private readonly statusPath: string;
  private readonly questionsPath: string;
  private readonly answersPath: string;
  private readonly manualNotesPath: string;
  private readonly blockersPath: string;
  private readonly eventsPath: string;
  private readonly agentOutputPath: string;
  private readonly answerInboxPath: string;
  private readonly noteInboxPath: string;
  private readonly inboxOffsetsPath: string;

  constructor(config: AppConfig) {
    this.config = config;
    this.stateDir = config.stateDir;
    this.logDir = config.logDir;

    this.statusPath = join(this.stateDir, 'status.json');
    this.questionsPath = join(this.stateDir, 'questions.json');
    this.answersPath = join(this.stateDir, 'answers.json');
    this.manualNotesPath = join(this.stateDir, 'manual-notes.json');
    this.blockersPath = join(this.stateDir, 'blockers.json');
    this.eventsPath = join(this.stateDir, 'events.jsonl');
    this.agentOutputPath = join(this.logDir, 'agent-output.log');
    this.answerInboxPath = join(this.stateDir, 'answer-inbox.jsonl');
    this.noteInboxPath = join(this.stateDir, 'note-inbox.txt');
    this.inboxOffsetsPath = join(this.stateDir, 'inbox-offsets.json');
  }

  async ensureInitialized(): Promise<void> {
    mkdirSync(this.stateDir, { recursive: true });
    mkdirSync(this.logDir, { recursive: true });

    this.writeJsonIfMissing(this.statusPath, defaultStatus(this.config));
    this.writeJsonIfMissing(this.questionsPath, []);
    this.writeJsonIfMissing(this.answersPath, []);
    this.writeJsonIfMissing(this.manualNotesPath, []);
    this.writeJsonIfMissing(this.blockersPath, []);
    this.writeJsonIfMissing(this.inboxOffsetsPath, { answersLineOffset: 0, notesLineOffset: 0 });

    if (!existsSync(this.eventsPath)) {
      writeFileSync(this.eventsPath, '', 'utf8');
    }

    if (!existsSync(this.agentOutputPath)) {
      writeFileSync(this.agentOutputPath, '', 'utf8');
    }

    if (!existsSync(this.answerInboxPath)) {
      writeFileSync(this.answerInboxPath, '', 'utf8');
    }

    if (!existsSync(this.noteInboxPath)) {
      writeFileSync(this.noteInboxPath, '', 'utf8');
    }
  }

  readStatus(): RunStatus {
    return this.readJson<RunStatus>(this.statusPath) ?? defaultStatus(this.config);
  }

  writeStatus(status: RunStatus): void {
    this.writeJson(this.statusPath, status);
  }

  readQuestions(): QuestionRecord[] {
    return this.readJson<QuestionRecord[]>(this.questionsPath) ?? [];
  }

  writeQuestions(questions: QuestionRecord[]): void {
    this.writeJson(this.questionsPath, questions);
  }

  readAnswers(): AnswerRecord[] {
    return this.readJson<AnswerRecord[]>(this.answersPath) ?? [];
  }

  writeAnswers(answers: AnswerRecord[]): void {
    this.writeJson(this.answersPath, answers);
  }

  readManualNotes(): ManualNoteRecord[] {
    return this.readJson<ManualNoteRecord[]>(this.manualNotesPath) ?? [];
  }

  writeManualNotes(notes: ManualNoteRecord[]): void {
    this.writeJson(this.manualNotesPath, notes);
  }

  readBlockers(): BlockerRecord[] {
    return this.readJson<BlockerRecord[]>(this.blockersPath) ?? [];
  }

  writeBlockers(blockers: BlockerRecord[]): void {
    this.writeJson(this.blockersPath, blockers);
  }

  async listRecentEvents(count: number): Promise<EventRecord[]> {
    const content = await this.readFileOrEmpty(this.eventsPath);
    const lines = content.split('\n').filter(Boolean);
    const recent = lines.slice(-count);

    return recent.map((line) => JSON.parse(line) as EventRecord);
  }

  async appendEvent(event: EventRecord): Promise<void> {
    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async readAgentOutputTail(lines: number): Promise<string[]> {
    const content = await this.readFileOrEmpty(this.agentOutputPath);
    const all = content.split('\n');
    return all.slice(-lines);
  }

  async appendAgentOutput(text: string): Promise<void> {
    await appendFile(this.agentOutputPath, text, 'utf8');
  }

  readInboxOffsets(): InboxOffsets {
    return this.readJson<InboxOffsets>(this.inboxOffsetsPath) ?? {
      answersLineOffset: 0,
      notesLineOffset: 0,
    };
  }

  writeInboxOffsets(offsets: InboxOffsets): void {
    this.writeJson(this.inboxOffsetsPath, offsets);
  }

  async readAnswerInboxLines(): Promise<string[]> {
    const content = await this.readFileOrEmpty(this.answerInboxPath);
    return content.split('\n');
  }

  async readNoteInboxLines(): Promise<string[]> {
    const content = await this.readFileOrEmpty(this.noteInboxPath);
    return content.split('\n');
  }

  private readJson<T>(filePath: string): T | null {
    if (!existsSync(filePath)) {
      return null;
    }

    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) {
      return null;
    }

    return JSON.parse(content) as T;
  }

  private writeJson(filePath: string, data: unknown): void {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  private writeJsonIfMissing(filePath: string, data: unknown): void {
    if (!existsSync(filePath)) {
      this.writeJson(filePath, data);
    }
  }

  private async readFileOrEmpty(filePath: string): Promise<string> {
    if (!existsSync(filePath)) {
      return '';
    }

    return readFile(filePath, 'utf8');
  }
}
