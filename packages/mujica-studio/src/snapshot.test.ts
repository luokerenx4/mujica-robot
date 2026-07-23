import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { sha256 } from "@mujica/core";
import { buildStudioSnapshot, writeStudioSnapshot } from "./snapshot";

const project = resolve(import.meta.dir, "../../../examples/quadruped");

describe("read-only Studio snapshot", () => {
  test("projects real robot evidence into a deterministic offline debugger", async () => {
    const first = await writeStudioSnapshot(project, { run: "run-e8bd80892b0f0123" });
    const second = await writeStudioSnapshot(project, { run: "run-e8bd80892b0f0123" });
    expect(second.id).toBe(first.id);
    expect(first.snapshot.selectedRun?.trajectory.total).toBe(250);
    expect((first.snapshot.selectedRun?.trajectory.rows.at(-1) as any).qpos[0]).toBeCloseTo(0.6681203053846321);
    expect(first.snapshot.assemblies.find((item) => item.id === "force-sensing-3dof")?.observationContract.size).toBe(45);
    expect(first.snapshot.benchmarks).toHaveLength(13);
    expect(first.snapshot.candidates).toHaveLength(9);
    expect(first.snapshot.hardwareBundles.length).toBeGreaterThanOrEqual(2);
    expect(first.snapshot.hardwareVerifications.length).toBeGreaterThanOrEqual(2);
    expect(first.snapshot.researchLabs.map((item) => item.id)).toContain("upright-residual-policy");
    const session = first.snapshot.researchSessions.find((item) => item.id === "session-2d54b3b2e5ee8251");
    expect(session?.experiments[0]).toMatchObject({ id: "001-7244577953a6", verdict: "REVERT" });
    const html = await readFile(first.indexPath, "utf8");
    expect(html).toContain("read-only evidence debugger");
    expect(html).toContain("Authoritative MuJoCo replay comparison");
    expect(html).toContain("Top-down path");
    expect(html).toContain("Research Lab ledger");
    expect(html).toContain("gate-regression");
    expect(html).toContain("Content-Security-Policy");
  });

  test("refuses to invent a missing run", async () => {
    await expect(buildStudioSnapshot(project, { run: "run-does-not-exist" })).rejects.toThrow("Unknown completed run");
  });

  test("projects two Runs onto one simulation-time comparison", async () => {
    const result = await writeStudioSnapshot(project, { run: "run-e8bd80892b0f0123", compareRun: "run-0307db1a1c3dc228" });
    expect(result.snapshot.selectedRun?.id).toBe("run-e8bd80892b0f0123");
    expect(result.snapshot.comparisonRun?.id).toBe("run-0307db1a1c3dc228");
    const html = await readFile(result.indexPath, "utf8");
    expect(html).toContain("shared simulation time");
    expect(html).toContain("Motion-quality deltas");
    expect(html).toContain("mujica-run-comparison-context");
    expect(html).toContain("subject − baseline");
  });

  test("copies a verified MuJoCo replay into the offline snapshot", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "mujica-studio-replay-"));
    try {
      const runId = "run-e8bd80892b0f0123";
      const runManifest = JSON.parse(await readFile(join(project, "runs", runId, "manifest.json"), "utf8"));
      const frameBytes = Buffer.from("\x89PNG\r\n\x1a\n");
      const manifest = {
        version: 1,
        id: "replay-test",
        kind: "mujica-simulation-replay",
        renderer: "mujica-runtime-mujoco-rgb-v1",
        mujocoVersion: "3.10.0",
        runId,
        resultHash: runManifest.resultHash,
        frameCount: 1,
        framePattern: "frames/%06d.png",
        frameHashes: [sha256(frameBytes)],
        frameTimes: [0.02],
        settings: { width: 160, height: 120 },
        completed: true,
      };
      await mkdir(join(temporary, "frames"));
      await writeFile(join(temporary, "frames", "000000.png"), frameBytes);
      await writeFile(join(temporary, "manifest.json"), JSON.stringify(manifest));
      const result = await writeStudioSnapshot(project, { run: runId, replay: { path: temporary, manifest } });
      expect(result.snapshot.selectedReplay).toMatchObject({ id: "replay-test", frameBase: "replay/frames" });
      expect(await readFile(join(result.path, "replay", "frames", "000000.png"))).toEqual(frameBytes);
      const html = await readFile(result.indexPath, "utf8");
      expect(html).toContain("Authoritative MuJoCo replay comparison");
      expect(html).toContain("Copy comparison context for Agent");
      expect(html).toContain("mujica-runtime-mujoco-rgb-v1");
      expect(html).toContain("img-src 'self' data:");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
