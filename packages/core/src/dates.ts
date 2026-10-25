const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assertIsoDate(value: string, field = "date"): string {
  if (!isIsoDate(value)) {
    throw new Error(`Invalid ISO date for ${field}: "${value}"`);
  }
  return value;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const parsed = Date.parse(`${assertIsoDate(date)}T00:00:00.000Z`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/** Absolute distance in days between two ISO dates. */
export function daysBetweenIso(a: string, b: string): number {
  const first = Date.parse(`${assertIsoDate(a, "a")}T00:00:00.000Z`);
  const second = Date.parse(`${assertIsoDate(b, "b")}T00:00:00.000Z`);
  return Math.abs(Math.round((first - second) / 86_400_000));
}
