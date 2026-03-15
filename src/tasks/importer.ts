export interface ImportedTaskDraft {
  title: string;
  summary: string;
  acceptanceCriteria: string[];
}

export interface TaskImportPreview {
  format: 'json' | 'list' | 'headings' | 'empty';
  tasks: ImportedTaskDraft[];
  truncated: boolean;
}

interface MutableImportedTaskDraft {
  title: string;
  summaryParts: string[];
  acceptanceCriteria: string[];
}

interface ParsedListItem {
  indent: number;
  text: string;
}

interface ParsedHeading {
  level: number;
  text: string;
}

interface MutableHeadingTaskDraft extends MutableImportedTaskDraft {
  level: number;
}

const MAX_IMPORTED_TASKS = 40;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTitleKey(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.:：-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeStrings(items: string[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalized = normalizeWhitespace(item);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(normalized);
  }

  return results;
}

function finalizeTasks(
  drafts: MutableImportedTaskDraft[],
  format: TaskImportPreview['format'],
): TaskImportPreview {
  const tasks: ImportedTaskDraft[] = [];
  const seenTitles = new Set<string>();
  let truncated = false;

  for (const draft of drafts) {
    const title = normalizeWhitespace(draft.title);
    if (!title) {
      continue;
    }

    const key = normalizeTitleKey(title);
    if (!key || seenTitles.has(key)) {
      continue;
    }

    seenTitles.add(key);

    tasks.push({
      title,
      summary: normalizeWhitespace(draft.summaryParts.join(' ')) || title,
      acceptanceCriteria: dedupeStrings(draft.acceptanceCriteria),
    });

    if (tasks.length >= MAX_IMPORTED_TASKS) {
      truncated = drafts.length > tasks.length;
      break;
    }
  }

  return {
    format: tasks.length > 0 ? format : 'empty',
    tasks,
    truncated,
  };
}

function parseHeadingMatch(line: string): ParsedHeading | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) {
    return null;
  }

  return {
    level: match[1]?.length ?? 1,
    text: normalizeWhitespace(match[2]),
  };
}

function parseHeading(line: string): string | null {
  return parseHeadingMatch(line)?.text ?? null;
}

function parseListItem(line: string): ParsedListItem | null {
  const match = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[(?: |x|X)\]\s+)?(.+)$/);
  if (!match) {
    return null;
  }

  return {
    indent: match[1].replace(/\t/g, '  ').length,
    text: normalizeWhitespace(match[2]),
  };
}

function splitInlineTask(text: string): { title: string; summary?: string } {
  const separators = [' - ', ' | ', '：', ':'];

  for (const separator of separators) {
    const index = text.indexOf(separator);
    if (index <= 0) {
      continue;
    }

    const left = normalizeWhitespace(text.slice(0, index));
    const right = normalizeWhitespace(text.slice(index + separator.length));
    if (!left || !right) {
      continue;
    }

    if (left.length <= 72 && right.length >= 8) {
      return { title: left, summary: right };
    }
  }

  return { title: normalizeWhitespace(text) };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && normalizeWhitespace(value)) {
      return normalizeWhitespace(value);
    }
  }

  return undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function toJsonDraft(value: unknown): ImportedTaskDraft | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = firstString(record.title, record.name, record.id);
  if (!title) {
    return null;
  }

  const summary = firstString(record.summary, record.description, record.notes) || title;
  return {
    title,
    summary,
    acceptanceCriteria: dedupeStrings([
      ...toStringArray(record.acceptanceCriteria),
      ...toStringArray(record.criteria),
      ...toStringArray(record.checklist),
    ]),
  };
}

function parseJsonTasks(text: string): TaskImportPreview | null {
  try {
    const payload = JSON.parse(text) as unknown;
    const drafts: ImportedTaskDraft[] = [];

    const pushDrafts = (items: unknown[]) => {
      for (const item of items) {
        const draft = toJsonDraft(item);
        if (draft) {
          drafts.push(draft);
        }
      }
    };

    if (Array.isArray(payload)) {
      pushDrafts(payload);
    } else if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;

      if (Array.isArray(record.userStories)) {
        pushDrafts(record.userStories);
      }

      if (Array.isArray(record.tasks)) {
        pushDrafts(record.tasks);
      }

      if (Array.isArray(record.items)) {
        pushDrafts(record.items);
      }

      if (drafts.length === 0) {
        const draft = toJsonDraft(record);
        if (draft) {
          drafts.push(draft);
        }
      }
    }

    if (drafts.length === 0) {
      return null;
    }

    return finalizeTasks(
      drafts.map((draft) => ({
        title: draft.title,
        summaryParts: [draft.summary],
        acceptanceCriteria: draft.acceptanceCriteria,
      })),
      'json',
    );
  } catch {
    return null;
  }
}

function parseListTasks(text: string): TaskImportPreview | null {
  const drafts: MutableImportedTaskDraft[] = [];
  const lines = text.split(/\r?\n/);
  let currentHeading = '';
  let currentTask: MutableImportedTaskDraft | null = null;
  let topLevelIndent = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      currentHeading = heading;
      currentTask = null;
      continue;
    }

    const item = parseListItem(line);
    if (item) {
      if (!currentTask || item.indent <= topLevelIndent) {
        const inline = splitInlineTask(item.text);
        currentTask = {
          title: inline.title,
          summaryParts: inline.summary
            ? [inline.summary]
            : currentHeading && normalizeTitleKey(currentHeading) !== normalizeTitleKey(inline.title)
            ? [currentHeading]
            : [],
          acceptanceCriteria: [],
        };
        drafts.push(currentTask);
        topLevelIndent = item.indent;
      } else {
        currentTask.acceptanceCriteria.push(item.text);
      }
      continue;
    }

    if (currentTask) {
      currentTask.summaryParts.push(trimmed);
    }
  }

  if (drafts.length === 0) {
    return null;
  }

  return finalizeTasks(drafts, 'list');
}

function parseHeadingTasks(text: string): TaskImportPreview {
  const drafts: MutableHeadingTaskDraft[] = [];
  const lines = text.split(/\r?\n/);
  let currentTask: MutableHeadingTaskDraft | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const heading = parseHeadingMatch(rawLine);
    if (heading) {
      currentTask = {
        title: heading.text,
        summaryParts: [],
        acceptanceCriteria: [],
        level: heading.level,
      };
      drafts.push(currentTask);
      continue;
    }

    if (currentTask) {
      currentTask.summaryParts.push(trimmed);
    }
  }

  const normalizedDrafts =
    drafts.length > 1 && drafts[0]?.level === 1 && drafts[0].summaryParts.length === 0
      ? drafts.slice(1)
      : drafts;

  return finalizeTasks(normalizedDrafts, 'headings');
}

export function parseTasksFromSpecText(text: string): TaskImportPreview {
  const normalized = text.trim();
  if (!normalized) {
    return { format: 'empty', tasks: [], truncated: false };
  }

  const jsonPreview = parseJsonTasks(normalized);
  if (jsonPreview) {
    return jsonPreview;
  }

  const listPreview = parseListTasks(normalized);
  if (listPreview) {
    return listPreview;
  }

  return parseHeadingTasks(normalized);
}
