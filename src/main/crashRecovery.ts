const RESTART_WINDOW_MS = 5 * 60 * 1000;
const MAX_RESTARTS = 2;
const ARGUMENT_PREFIX = '--main-crash-restarts=';

export function crashRestartArgs(args: string[], now = Date.now()): string[] | null {
  const recent = args
    .find((value) => value.startsWith(ARGUMENT_PREFIX))
    ?.slice(ARGUMENT_PREFIX.length)
    .split(',')
    .map(Number)
    .filter((value) => Number.isFinite(value) && now - value <= RESTART_WINDOW_MS) ?? [];
  if (recent.length >= MAX_RESTARTS) return null;
  return [
    ...args.filter((value) => !value.startsWith(ARGUMENT_PREFIX)),
    `${ARGUMENT_PREFIX}${[...recent, now].join(',')}`
  ];
}
