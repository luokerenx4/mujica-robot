import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const strategiesBeforeConjunctiveProbe = [
  "delay-one-dynamic-recovery-windowed-residual",
  "first-recovery-only-delay-one-residual",
  "task-target-closed-loop-history-recovery",
  "phase-bounded-ramped-history-recovery",
  "deadline-closed-phase-bounded-history-recovery",
  "predeadline-target-seeking-rise-recovery",
];

request.history = strategiesBeforeConjunctiveProbe.map((strategy) => ({
  proposal: { strategy },
}));

const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "agent.mjs")],
  {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  },
);
child.stdin.write(JSON.stringify(request));
child.stdin.end();
const output = await new Response(child.stdout).text();
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
process.stdout.write(output);
