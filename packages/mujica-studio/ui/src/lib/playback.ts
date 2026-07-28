const EPSILON_SECONDS = 1e-9;

export function nextPlaybackStep(
  times: number[],
  index: number,
  speed: number,
): { delayMs: number; nextIndex: number } {
  const from = times[index] ?? 0;
  const to = times[index + 1] ?? from;
  const exactDelayMs = (1_000 * Math.max(0, to - from)) / speed;
  if (exactDelayMs >= 8) {
    return { delayMs: exactDelayMs, nextIndex: index + 1 };
  }

  const delayMs = 16;
  const targetTime = from + (delayMs * speed) / 1_000;
  let nextIndex = index + 1;
  while (
    nextIndex < times.length - 1
    && Number(times[nextIndex + 1]) <= targetTime + EPSILON_SECONDS
  ) {
    nextIndex += 1;
  }
  return { delayMs, nextIndex };
}
