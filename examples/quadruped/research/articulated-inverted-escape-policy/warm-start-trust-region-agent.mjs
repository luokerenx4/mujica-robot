import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  [
    "bun",
    resolve(
      import.meta.dir,
      "counterfactual-reflex-distillation-agent.mjs",
    ),
  ],
  { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
);
child.stdin.write(JSON.stringify(request));
child.stdin.end();
const baseProposalText = await new Response(child.stdout).text();
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
const baseProposal = JSON.parse(baseProposalText);

const trainingPath = resolve(
  request.workspace,
  "training/articulated-inverted-escape.training.json",
);
const training = JSON.parse(await readFile(trainingPath, "utf8"));
training.warmStart = {
  policy: "articulated-inverted-escape-dcff66d30460b6e1",
  normalizer: "frozen",
  trustRegion: {
    kind: "reverse-kl-to-frozen-policy",
    coefficient: 0.1,
    maximumMeanKl: 0.005,
  },
};
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "warm-start-counterfactual-trust-region",
  hypothesis:
    "Direct from-scratch reflex distillation changed the complete-Mission learning basin and erased behavior already present in the executable parent candidate. Start byte-identically from Policy articulated-inverted-escape-dcff66d30460b6e1 and its frozen Observation normalizer, use the same 62-frame contrastive local course only during the first 8,192 steps, freeze the parent's active observations from a deterministic complete-Mission probe as the trust-region distribution, and reject every optimizer update whose mean reverse KL on that fixed distribution exceeds 0.005. The parent is executable but not accepted; promotion still requires beating the Program reference on the unchanged locked continuous Mission and every regression suite.",
  expectedEffect:
    "Preserve the parent's state-conditioned recovery behavior while allowing a bounded local correction, expose accepted versus rolled-back optimizer steps and measured KL as immutable evidence, and determine whether the local proxy can improve complete-Mission recovery without exchanging direction, handoff, or command failures.",
}));
