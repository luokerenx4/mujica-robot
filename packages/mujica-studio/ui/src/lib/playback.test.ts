import { describe, expect, test } from "bun:test";
import { nextPlaybackStep } from "./playback";

describe("nextPlaybackStep", () => {
  test("preserves sparse replay timing", () => {
    expect(nextPlaybackStep([0, 0.1, 0.2], 0, 1)).toEqual({
      delayMs: 100,
      nextIndex: 1,
    });
  });

  test("skips dense 1 kHz evidence by simulation time", () => {
    const times = Array.from({ length: 101 }, (_, index) => index / 1_000);
    expect(nextPlaybackStep(times, 0, 1)).toEqual({
      delayMs: 16,
      nextIndex: 16,
    });
    expect(nextPlaybackStep(times, 0, 2)).toEqual({
      delayMs: 16,
      nextIndex: 32,
    });
  });
});
