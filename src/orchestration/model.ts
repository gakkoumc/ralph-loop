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
  const activeIds = new Set(pendingTasks.slice(0, maxIntegration).map((task) => task.id));

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
    name: 'Supervisor',
    role: 'supervisor',
    status:
      input.status.lifecycle === 'completed'
        ? 'done'
        : input.status.lifecycle === 'failed' || input.status.lifecycle === 'aborted'
          ? 'blocked'
          : input.status.control === 'paused'
            ? 'waiting'
            : 'thinking',
    focus: input.status.currentStatusText || 'Loop coordination and routing',
    load: activeTasks.length + input.pendingQuestions.length + input.blockerCount,
    capacity: Math.max(1, maxIntegration),
    taskIds: activeTasks.slice(0, 2).map((task) => task.id),
    updatedAt: now,
  });

  agentLanes.push({
    id: 'planner',
    name: 'Planner',
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
        ? `${input.pendingQuestions.length} human answer(s) pending`
        : queuedTasks.length > 0
          ? `${queuedTasks.length} task(s) queued for next pass`
          : 'Task graph aligned',
    load: queuedTasks.length + input.pendingQuestions.length,
    capacity: Math.max(1, maxIntegration),
    taskIds: queuedTasks.slice(0, 3).map((task) => task.id),
    updatedAt: now,
  });

  for (let index = 0; index < maxIntegration; index += 1) {
    const task = activeTasks[index];
    agentLanes.push({
      id: `worker-${index + 1}`,
      name: `Worker ${index + 1}`,
      role: 'worker',
      status:
        task?.displayStatus === 'active'
          ? 'thinking'
          : input.status.lifecycle === 'completed'
            ? 'done'
            : input.status.control === 'paused'
              ? 'waiting'
              : 'idle',
      focus: task ? task.title : 'Open capacity for new task slices',
      load: task ? 1 : 0,
      capacity: 1,
      taskIds: task ? [task.id] : [],
      updatedAt: now,
    });
  }

  agentLanes.push({
    id: 'integrator',
    name: 'Integrator',
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
        ? `${input.blockers.length} blocker signal(s) isolated`
        : completedTasks.length > 0
          ? `${completedTasks.length} completed slice(s) ready to fold in`
          : 'No finished slice to integrate yet',
    load: completedTasks.length + input.blockers.length,
    capacity: maxIntegration,
    taskIds: completedTasks.slice(-maxIntegration).map((task) => task.id),
    updatedAt: now,
  });

  const thinkingFrames = [
    input.status.thinkingText || input.status.currentStatusText || 'Ralph is rebuilding the run as an orchestration deck.',
    `${activeTasks.length} active lane(s), ${queuedTasks.length} queued, ${completedTasks.length} completed.`,
    `MaxIntegration ${maxIntegration} is derived from ${unfinishedTasks.length || sortedTasks.length} task(s).`,
  ];

  if (input.pendingQuestions.length > 0) {
    thinkingFrames.push(
      `${input.pendingQuestions.length} human answer(s) are pending. Unblocked lanes keep moving.`,
    );
  }

  if (input.promptInjectionQueue.length > 0) {
    thinkingFrames.push(
      `${input.promptInjectionQueue.length} injection item(s) are staged for the next turn.`,
    );
  }

  if (input.blockers.length > 0) {
    thinkingFrames.push(
      `${input.blockers.length} blocker signal(s) are visible without freezing the whole run.`,
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
