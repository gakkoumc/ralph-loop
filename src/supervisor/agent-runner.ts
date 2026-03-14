import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { AppConfig } from '../config.ts';
import { runMockAgent } from '../demo/mock-agent.ts';

export interface AgentRunResult {
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class AgentRunner {
  private currentChild: ChildProcessWithoutNullStreams | null = null;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async run(prompt: string, iteration: number): Promise<AgentRunResult> {
    if (this.config.mode === 'demo') {
      const output = await runMockAgent(prompt, iteration);
      return {
        output,
        exitCode: 0,
        signal: null,
      };
    }

    return new Promise((resolve, reject) => {
      const child = spawn(this.config.agentCommand, {
        cwd: this.config.rootDir,
        shell: true,
        stdio: 'pipe',
        env: {
          ...process.env,
          RALPH_ITERATION: String(iteration),
        },
      });

      this.currentChild = child;
      let output = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        output += chunk;
      });
      child.on('error', reject);
      child.on('close', (exitCode, signal) => {
        this.currentChild = null;
        resolve({ output, exitCode, signal });
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  abortCurrent(): void {
    if (!this.currentChild) {
      return;
    }

    this.currentChild.kill('SIGTERM');
    this.currentChild = null;
  }
}
