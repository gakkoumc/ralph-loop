import type { MarkerMatch } from '../shared/types.ts';

const MARKER_PATTERN = /^\[\[(STATUS|QUESTION|BLOCKER|DONE|THINKING|TASK)\]\]\s*(.*)$/;

export function parseStructuredMarkers(output: string): MarkerMatch[] {
  const lines = output.split(/\r?\n/);
  const markers: MarkerMatch[] = [];
  let current: MarkerMatch | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(MARKER_PATTERN);

    if (match) {
      if (current) {
        current.content = current.content.trim();
        current.raw = current.raw.trimEnd();
        markers.push(current);
      }

      current = {
        kind: match[1] as MarkerMatch['kind'],
        content: match[2] ?? '',
        raw: line,
        lineStart: index + 1,
        lineEnd: index + 1,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.content = current.content ? `${current.content}\n${line}` : line;
    current.raw = `${current.raw}\n${line}`;
    current.lineEnd = index + 1;
  }

  if (current) {
    current.content = current.content.trim();
    current.raw = current.raw.trimEnd();
    markers.push(current);
  }

  return markers;
}
