import type {
  AgentLaneSnapshot,
  BlockerRecord,
  OrchestrationSnapshot,
  PromptInjectionItem,
  QuestionRecord,
  RunStatus,
  TaskBoardItem,
  TaskRecord,
} from '../shared/types.ts';

const PRIORITY_WEIGHT: Record<TaskRecord['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((left, right) => {
    const orderDelta = left.sortIndex - right.sortIndex;
    if (orderDelta !== 0) {
      return orderDelta;
    }

    const priorityDelta = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

export function deriveMaxIntegration(taskCount: number): number {
  if (taskCount <= 0) {
    return 1;
  }

  return clamp(Math.ceil(taskCount / 3) + 1, 2, 6);
}

export interface BuildOrchestrationInput {
  status: RunStatus;
  tasks: TaskRecord[];
  pendingQuestions: QuestionRecord[];
  blockers: BlockerRecord[];
  promptInjectionQueue: PromptInjectionItem[];
}

export function buildOrchestrationSnapshot(
  input: BuildOrchestrationInput,
): OrchestrationSnapshot {
  const sortedTasks = sortTasks(input.tasks);
  const unfinishedTasks = sortedTasks.filter((task) => task.status !== 'completed');
  const maxIntegration = deriveMaxIntegration(unfinishedTasks.length || sortedTasks.length);
  const pendingTasks = unfinishedTasks.filter((task) => task.status === 'pending');
  const activeIds = new Set(pendingTasks.slice(0, 1).map((task) => task.id));

  const taskBoard: TaskBoardItem[] = sortedTasks.map((task) => {
    const displayStatus =
      task.status === 'completed'
        ? 'completed'
        : task.status === 'blocked'
          ? 'blocked'
          : activeIds.has(task.id)
            ? 'active'
            : 'queued';

    return {
      ...task,
      displayStatus,
      laneId: displayStatus === 'active' ? `worker-${pendingTasks.indexOf(task) + 1}` : undefined,
    };
  });

  const activeTasks = taskBoard.filter((task) => task.displayStatus === 'active');
  const queuedTasks = taskBoard.filter((task) => task.displayStatus === 'queued');
  const completedTasks = taskBoard.filter((task) => task.displayStatus === 'completed');

  const agentLanes: AgentLaneSnapshot[] = [];
  const now = input.status.updatedAt;

  agentLanes.push({
    id: 'supervisor',
    name: '監督レーン',
    role: 'supervisor',
    status:
      input.status.lifecycle === 'completed'
        ? 'done'
        : input.status.lifecycle === 'failed' || input.status.lifecycle === 'aborted'
          ? 'blocked'
          : input.status.control === 'paused'
            ? 'waiting'
            : 'thinking',
    focus: input.status.currentStatusText || '全体の進行を監督し、次の一手を振り分けています',
    load: activeTasks.length + input.pendingQuestions.length + input.blockerCount,
    capacity: Math.max(1, maxIntegration),
    taskIds: activeTasks.slice(0, 2).map((task) => task.id),
    updatedAt: now,
  });

  agentLanes.push({
    id: 'planner',
    name: '計画レーン',
    role: 'planner',
    status:
      input.pendingQuestions.length > 0
        ? 'waiting'
        : queuedTasks.length > 0 || activeTasks.length > 0
          ? 'thinking'
          : input.status.lifecycle === 'completed'
            ? 'done'
            : 'idle',
    focus:
      input.pendingQuestions.length > 0
        ? `${input.pendingQuestions.length} 件の人間回答待ちがあります`
        : queuedTasks.length > 0
          ? `${queuedTasks.length} 件のTaskを次回に回します`
          : 'Taskの流れは整理済みです',
    load: queuedTasks.length + input.pendingQuestions.length,
    capacity: Math.max(1, maxIntegration),
    taskIds: queuedTasks.slice(0, 3).map((task) => task.id),
    updatedAt: now,
  });

  for (let index = 0; index < maxIntegration; index += 1) {
    const task = activeTasks[index];
    agentLanes.push({
      id: `worker-${index + 1}`,
      name: `実行レーン ${index + 1}`,
      role: 'worker',
      status:
        task?.displayStatus === 'active'
          ? 'thinking'
          : input.status.lifecycle === 'completed'
            ? 'done'
            : input.status.control === 'paused'
              ? 'waiting'
              : 'idle',
      focus: task ? task.title : '次のTaskを受け取れる待機枠です',
      load: task ? 1 : 0,
      capacity: 1,
      taskIds: task ? [task.id] : [],
      updatedAt: now,
    });
  }

  agentLanes.push({
    id: 'integrator',
    name: '統合レーン',
    role: 'integrator',
    status:
      input.blockers.length > 0
        ? 'blocked'
        : completedTasks.length > 0 && unfinishedTasks.length > 0
          ? 'thinking'
          : input.status.lifecycle === 'completed'
            ? 'done'
            : activeTasks.length > 0
              ? 'waiting'
              : 'idle',
    focus:
      input.blockers.length > 0
        ? `${input.blockers.length} 件の要対応を切り出しています`
        : completedTasks.length > 0
          ? `${completedTasks.length} 件の完了Taskを取り込めます`
          : 'まだ統合待ちの完了Taskはありません',
    load: completedTasks.length + input.blockers.length,
    capacity: maxIntegration,
    taskIds: completedTasks.slice(-maxIntegration).map((task) => task.id),
    updatedAt: now,
  });

  const thinkingFrames = [
    input.status.thinkingText || input.status.currentStatusText || 'Ralph が Task の流れを組み直しています。',
    `${activeTasks.length} 件進行中、${queuedTasks.length} 件待機、${completedTasks.length} 件完了です。`,
    `MaxIntegration は ${unfinishedTasks.length || sortedTasks.length} 件のTaskから ${maxIntegration} に決まっています。`,
  ];

  if (input.pendingQuestions.length > 0) {
    thinkingFrames.push(
      `${input.pendingQuestions.length} 件の回答待ちがありますが、止まらず進めています。`,
    );
  }

  if (input.promptInjectionQueue.length > 0) {
    thinkingFrames.push(
      `${input.promptInjectionQueue.length} 件の差し込み情報を次のターンに回します。`,
    );
  }

  if (input.blockers.length > 0) {
    thinkingFrames.push(
      `${input.blockers.length} 件の要対応を可視化しつつ、全体は止めていません。`,
    );
  }

  return {
    maxIntegration,
    totalTaskCount: taskBoard.length,
    activeTaskCount: activeTasks.length,
    completedTaskCount: completedTasks.length,
    queuedTaskCount: queuedTasks.length,
    taskBoard,
    agentLanes,
    thinkingFrames: [...new Set(thinkingFrames.filter(Boolean))],
  };
}
