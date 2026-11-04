const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

export const DURATION_PATTERN = /^([1-9]\d*)(s|m|h|d)$/;

export const parseDurationMs = (value: string): number => {
  const match = DURATION_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Use a whole number followed by s, m, h or d (e.g. 7d).`,
    );
  }
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
};
