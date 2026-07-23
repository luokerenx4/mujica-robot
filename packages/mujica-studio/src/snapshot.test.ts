import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
    expect(first.snapshot.benchmarks).toHaveLength(11);
    expect(first.snapshot.candidates).toHaveLength(9);
    expect(first.snapshot.hardwareBundles.length).toBeGreaterThanOrEqual(2);
    expect(first.snapshot.hardwareVerifications.length).toBeGreaterThanOrEqual(2);
    expect(first.snapshot.researchLabs.map((item) => item.id)).toContain("upright-residual-policy");
    const session = first.snapshot.researchSessions.find((item) => item.id === "session-2d54b3b2e5ee8251");
    expect(session?.experiments[0]).toMatchObject({ id: "001-7244577953a6", verdict: "REVERT" });
    const html = await readFile(first.indexPath, "utf8");
    expect(html).toContain("read-only evidence debugger");
    expect(html).toContain("Trajectory replay");
    expect(html).toContain("Research Lab ledger");
    expect(html).toContain("gate-regression");
    expect(html).toContain("Content-Security-Policy");
  });

  test("refuses to invent a missing run", async () => {
    await expect(buildStudioSnapshot(project, { run: "run-does-not-exist" })).rejects.toThrow("Unknown completed run");
  });
});
