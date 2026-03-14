import { existsSync, readFileSync } from 'node:fs';

import type { AppConfig } from '../config.ts';
import type { StoredTaskStatus, TaskPriority, TaskRecord } from '../shared/types.ts';

interface PrdStory {
  id?: string;
  title?: string;
  acceptanceCriteria?: string[];
  priority?: number;
  passes?: boolean;
  notes?: string;
}

interface PrdPayload {
  userStories?: PrdStory[];
}

export interface TaskSeed {
  id: string;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
  priority: TaskPriority;
  sortIndex: number;
  status: StoredTaskStatus;
  notes?: string;
  source: string;
}

function mapPriority(value?: number): TaskPriority {
  if (value === 1) {
    return 'critical';
  }

  if (value === 2) {
    return 'high';
  }

  if (value === 3) {
    return 'medium';
  }

  return 'low';
}

function toTaskSeed(story: PrdStory, index: number): TaskSeed | null {
  if (!story.id || !story.title) {
    return null;
  }

  return {
    id: story.id,
    title: story.title,
    summary: story.title,
    acceptanceCriteria: story.acceptanceCriteria ?? [],
    priority: mapPriority(story.priority),
    sortIndex: index + 1,
    status: story.passes ? 'completed' : 'pending',
    notes: story.notes || undefined,
    source: 'prd',
  };
}

export function loadTaskSeeds(config: AppConfig): TaskSeed[] {
  if (!existsSync(config.taskCatalogFile)) {
    return [];
  }

  try {
    const payload = JSON.parse(readFileSync(config.taskCatalogFile, 'utf8')) as PrdPayload;
    return (payload.userStories ?? [])
      .map((story, index) => toTaskSeed(story, index))
      .filter((story): story is TaskSeed => Boolean(story));
  } catch {
    return [];
  }
}

export function makeSyntheticTask(taskName: string, timestamp: string): TaskRecord {
  return {
    id: 'TASK-001',
    title: taskName || 'Ralph root task',
    summary: taskName || 'Ralph root task',
    priority: 'high',
    sortIndex: 1,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    source: 'runtime',
    acceptanceCriteria: [],
  };
}
