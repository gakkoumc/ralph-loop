export function nextSequentialId(prefix: string, existingIds: string[]): string {
  const currentMax = existingIds.reduce((max, id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) {
      return max;
    }

    return Math.max(max, Number.parseInt(match[1], 10));
  }, 0);

  return `${prefix}-${String(currentMax + 1).padStart(3, '0')}`;
}

export function createRunId(date: Date = new Date()): string {
  const timestamp = date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `RUN-${timestamp}`;
}

export function createEventId(date: Date = new Date()): string {
  const timestamp = date
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 17);
  const entropy = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `E-${timestamp}-${entropy}`;
}
