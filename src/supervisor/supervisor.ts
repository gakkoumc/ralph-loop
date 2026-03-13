import { RunActions } from '../actions/run-actions.ts';
import type { AppConfig } from '../config.ts';
import type { Notifier } from '../shared/notifier.ts';
import { sleep } from '../shared/time.ts';
import { AgentRunner } from './agent-runner.ts';

export class Supervisor {
  private readonly runner: AgentRunner;
  private isRunning = false;
  private isWatching = false;
  private pauseNoticeShown = false;
  private readonly config: AppConfig;
  private readonly actions: RunActions;
  private readonly notifier: Notifier;

  constructor(config: AppConfig, actions: RunActions, notifier: Notifier) {
    this.config = config;
    this.actions = actions;
    this.notifier = notifier;
    this.runner = new AgentRunner(config);
  }

  async watch(): Promise<void> {
    if (this.isWatching) {
      return;
    }

    this.isWatching = true;

    while (this.isWatching) {
      if (this.isRunning) {
        await sleep(500);
        continue;
      }

      const status = this.actions.getStatus();
      if (status.phase === 'queued' && status.control !== 'abort_requested') {
        await this.start();
        continue;
      }

      await sleep(500);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const started = await this.actions.markRunStarted();
      await this.notifier.notifyRunStarted(started);

      for (let iteration = started.iteration + 1; iteration <= this.config.maxIterations; iteration += 1) {
        const shouldStop = await this.waitWhilePausedOrAborting();
        if (shouldStop) {
          return;
        }

        await this.actions.updateIteration(iteration);
        const prompt = await this.actions.preparePromptForNextTurn();
        const result = await this.runner.run(prompt, iteration);
        await this.actions.appendAgentOutput(result.output, iteration);

        const markerResult = await this.processOutput(result.output);
        if (markerResult.done) {
          await this.notifier.notifyDone('DONE marker を検知しました');
          return;
        }

        if (result.exitCode && result.exitCode !== 0) {
          await this.actions.recordAgentStatus(
            `agent command は exit code ${result.exitCode} で終了しましたが、loop は継続します`,
          );
        }

        const aborted = await this.waitIfPauseRequestedAfterTurn();
        if (aborted) {
          return;
        }

        if (iteration < this.config.maxIterations) {
          await sleep(this.config.idleSeconds * 1000);
        }
      }

      await this.actions.markMaxIterationsReached();
    } catch (error) {
      await this.actions.markRuntimeError(error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  abortCurrentTurn(reason: string): void {
    this.runner.abortCurrent();
    void this.notifier.notifyRunAborted(reason);
  }

  private async processOutput(output: string): Promise<{ done: boolean }> {
    const parsed = await this.actions.handleAgentOutput(output);

    for (const marker of parsed.markers) {
      if (marker.kind === 'STATUS') {
        await this.notifier.notifyStatus(marker.content);
      }

      if (marker.kind === 'QUESTION') {
        const pendingQuestions = this.actions.listPendingQuestions();
        const latest = pendingQuestions[pendingQuestions.length - 1];
        if (latest && latest.text === marker.content) {
          await this.notifier.notifyQuestion(latest);
        }
      }

      if (marker.kind === 'BLOCKER') {
        const blockers = (await this.actions.getDashboardData()).blockers;
        const latest = blockers[0];
        if (latest && latest.text === marker.content) {
          await this.notifier.notifyBlocker(latest);
        }
      }
    }

    return { done: parsed.done };
  }

  private async waitWhilePausedOrAborting(): Promise<boolean> {
    while (true) {
      const status = this.actions.getStatus();
      if (status.control === 'abort_requested' || status.control === 'aborted') {
        this.runner.abortCurrent();
        return true;
      }

      if (status.control === 'paused') {
        if (!this.pauseNoticeShown) {
          await this.actions.recordAgentStatus('pause 中です。resume を待っています');
          this.pauseNoticeShown = true;
        }
        await sleep(1000);
        continue;
      }

      this.pauseNoticeShown = false;
      return false;
    }
  }

  private async waitIfPauseRequestedAfterTurn(): Promise<boolean> {
    while (true) {
      const status = this.actions.getStatus();
      if (status.control === 'abort_requested' || status.control === 'aborted') {
        this.runner.abortCurrent();
        return true;
      }

      if (status.control === 'paused') {
        const current = this.actions.getStatus();
        if (current.lifecycle !== 'paused') {
          current.lifecycle = 'paused';
          current.phase = 'paused';
          current.updatedAt = new Date().toISOString();
          this.actions.store.writeStatus(current);
        }
        this.pauseNoticeShown = true;
        await sleep(1000);
        continue;
      }

      this.pauseNoticeShown = false;
      return false;
    }
  }
}
