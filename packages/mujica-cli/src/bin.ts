#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolveProjectDirectory } from "@mujica/core";
import { failure } from "./contract";
import { hardwareCaptureCommand, hardwareCaptureInspectCommand, hardwareCapturePlanInspectCommand, hardwareCapturePlanListCommand, hardwareExportCommand, hardwareVerifyCommand } from "./hardware";
import {
  assemblyCompareCommand, assemblyCompileCommand, assemblyInspectCommand, benchmarkLockCommand, calibrateCommand, calibrationInspectCommand, calibrationListCommand, calibrationPromoteCommand, candidateCommand, componentInspectCommand, componentListCommand, controllerInspectCommand, controllerListCommand, diagnoseCommand, domainInspectCommand, domainListCommand, driverInspectCommand, driverListCommand, evaluateCommand, inspectCommand,
  policiesCommand, policyInspectCommand, policyRequalifyCommand, policyRevisionInspectCommand, policyRevisionsCommand, researchCommand, revisionInspectCommand, revisionsCommand, simulateCommand, studioCommand, trainCommand, trainingResearchCommand, validateCommand,
} from "./commands";
import { researchLabInspectCommand, researchLabListCommand, researchLabRunCommand, researchLabStatusCommand } from "./research-lab";

const HELP = `mujica — AI-native robot development harness

USAGE
  mujica validate|inspect <project> [--json]
  mujica component list <project> [--json]
  mujica component inspect <project> --component ID [--json]
  mujica domain list <project> [--json]
  mujica domain inspect <project> --domain ID [--json]
  mujica driver list <project> [--json]
  mujica driver inspect <project> --driver ID [--json]
  mujica calibration list <project> [--json]
  mujica calibration inspect <project> --calibration ID [--json]
  mujica calibration promote <project> --run ID [--json]
  mujica calibrate <project> --calibration ID [--json]
  mujica controller list <project> [--json]
  mujica controller inspect <project> --controller ID [--json]
  mujica assembly inspect|compile <project> --assembly ID [--json]
  mujica assembly compare <project> --from ID --to ID [--json]
  mujica simulate <project> --assembly ID --controller ID --task ID --scenario ID [--seed N]
  mujica studio <project> [--run ID] [--compare-run ID] [--json]
  mujica hardware export <project> --target ID [--json]
  mujica hardware verify <project> --bundle ID --evidence PATH [--json]
  mujica capture list <project> [--json]
  mujica capture inspect <project> (--plan ID | --capture ID) [--json]
  mujica capture run <project> --plan ID --operator NAME [--driver PATH] [--driver-arg ARG] [--driver-input PATH] [--authorization PATH] [--json]
  mujica train <project> --training ID [--seed N]
  mujica train-research <project> --research ID [--iterations N] [--agent-command CMD] [--json]
  mujica policies <project> [--json]
  mujica policy inspect <project> --policy ID [--json]
  mujica policy requalify <project> --policy ID --assembly ID [--json]
  mujica policy-revisions <project> [--json]
  mujica policy-revision inspect <project> --revision ID [--json]
  mujica benchmark lock <project> --benchmark ID [--json]
  mujica evaluate <project> --assembly ID --controller ID --benchmark ID [--json]
  mujica diagnose <project> --assembly ID --controller ID --benchmark ID [--json]
  mujica candidate <project> --candidate ID [--apply] [--json]
  mujica research list <project> [--json]
  mujica research inspect|status <project> --lab ID [--json]
  mujica research run <project> --lab ID --iterations N --agent-command CMD [--json]
  mujica research <project> --research ID [--iterations N] [--agent-command CMD] [--json]
  mujica revisions <project> [--json]
  mujica revision inspect <project> --revision ID [--json]
`;

const CAPABILITIES = [
  { id: "validate", usage: "mujica validate <project> [--json]", effect: "read-only" },
  { id: "inspect", usage: "mujica inspect <project> [--json]", effect: "read-only" },
  { id: "component.list", usage: "mujica component list <project> [--json]", effect: "read-only" },
  { id: "component.inspect", usage: "mujica component inspect <project> --component ID [--json]", effect: "read-only" },
  { id: "domain.list", usage: "mujica domain list <project> [--json]", effect: "read-only" },
  { id: "domain.inspect", usage: "mujica domain inspect <project> --domain ID [--json]", effect: "read-only" },
  { id: "driver.list", usage: "mujica driver list <project> [--json]", effect: "read-only" },
  { id: "driver.inspect", usage: "mujica driver inspect <project> --driver ID [--json]", effect: "read-only" },
  { id: "calibration.list", usage: "mujica calibration list <project> [--json]", effect: "read-only" },
  { id: "calibration.inspect", usage: "mujica calibration inspect <project> --calibration ID [--json]", effect: "read-only" },
  { id: "calibration.promote", usage: "mujica calibration promote <project> --run ID [--json]", effect: "mutates-project" },
  { id: "calibrate", usage: "mujica calibrate <project> --calibration ID [--json]", effect: "creates-artifact" },
  { id: "controller.list", usage: "mujica controller list <project> [--json]", effect: "read-only" },
  { id: "controller.inspect", usage: "mujica controller inspect <project> --controller ID [--json]", effect: "read-only" },
  { id: "assembly.inspect", usage: "mujica assembly inspect <project> --assembly ID [--json]", effect: "read-only" },
  { id: "assembly.compile", usage: "mujica assembly compile <project> --assembly ID [--json]", effect: "creates-artifact" },
  { id: "assembly.compare", usage: "mujica assembly compare <project> --from ID --to ID [--json]", effect: "read-only" },
  { id: "simulate", usage: "mujica simulate <project> --assembly ID --controller ID --task ID --scenario ID [--seed N] [--json]", effect: "creates-artifact" },
  { id: "studio", usage: "mujica studio <project> [--run ID] [--compare-run ID] [--json]", effect: "creates-artifact" },
  { id: "hardware.export", usage: "mujica hardware export <project> --target ID [--json]", effect: "creates-artifact" },
  { id: "hardware.verify", usage: "mujica hardware verify <project> --bundle ID --evidence PATH [--json]", effect: "creates-artifact" },
  { id: "capture.list", usage: "mujica capture list <project> [--json]", effect: "read-only" },
  { id: "capture.inspect", usage: "mujica capture inspect <project> (--plan ID | --capture ID) [--json]", effect: "read-only" },
  { id: "capture.run", usage: "mujica capture run <project> --plan ID --operator NAME [--driver PATH] [--driver-arg ARG] [--driver-input PATH] [--authorization PATH] [--json]", effect: "creates-artifact" },
  { id: "train", usage: "mujica train <project> --training ID [--seed N] [--json]", effect: "creates-artifact" },
  { id: "train-research", usage: "mujica train-research <project> --research ID [--iterations N] [--agent-command CMD] [--json]", effect: "mutates-project" },
  { id: "policies", usage: "mujica policies <project> [--json]", effect: "read-only" },
  { id: "policy.inspect", usage: "mujica policy inspect <project> --policy ID [--json]", effect: "read-only" },
  { id: "policy.requalify", usage: "mujica policy requalify <project> --policy ID --assembly ID [--json]", effect: "creates-artifact" },
  { id: "policy-revisions", usage: "mujica policy-revisions <project> [--json]", effect: "read-only" },
  { id: "policy-revision.inspect", usage: "mujica policy-revision inspect <project> --revision ID [--json]", effect: "read-only" },
  { id: "benchmark.lock", usage: "mujica benchmark lock <project> --benchmark ID [--json]", effect: "mutates-project" },
  { id: "evaluate", usage: "mujica evaluate <project> --assembly ID --controller ID --benchmark ID [--json]", effect: "read-only" },
  { id: "diagnose", usage: "mujica diagnose <project> --assembly ID --controller ID --benchmark ID [--json]", effect: "read-only" },
  { id: "candidate", usage: "mujica candidate <project> --candidate ID [--apply] [--json]", effect: "mode-dependent" },
  { id: "research.list", usage: "mujica research list <project> [--json]", effect: "read-only" },
  { id: "research.inspect", usage: "mujica research inspect <project> --lab ID [--json]", effect: "read-only" },
  { id: "research.status", usage: "mujica research status <project> --lab ID [--json]", effect: "read-only" },
  { id: "research.run", usage: "mujica research run <project> --lab ID [--iterations N] --agent-command CMD [--json]", effect: "mutates-project" },
  { id: "research", usage: "mujica research <project> --research ID [--iterations N] [--agent-command CMD] [--json]", effect: "mutates-project" },
  { id: "revisions", usage: "mujica revisions <project> [--json]", effect: "read-only" },
  { id: "revision.inspect", usage: "mujica revision inspect <project> --revision ID [--json]", effect: "read-only" },
] as const;

function required(value: string | undefined, option: string): string { if (!value) throw new Error(`Missing required --${option}`); return value; }
function one(positionals: string[], usage: string): string { if (positionals.length !== 1 || !positionals[0]) throw new Error(`Usage: ${usage}`); return positionals[0]; }
function printHuman(command: string, data: any): void {
  if (command === "validate") process.stdout.write(`Valid Mujica project '${data.project.id}'\nassemblies=${data.assemblies.length} components=${data.components.length}\n`);
  else if (command === "controller.list") process.stdout.write(`${data.controllers.map((controller: any) => `${controller.id}\t${controller.kind}\tcompatible=${controller.compatibleAssemblies.join(",") || "none"}`).join("\n")}\n`);
  else if (command === "domain.list") process.stdout.write(`${data.profiles.map((profile: any) => `${profile.id}\t${profile.provenance.kind}\t${profile.hash.slice(0, 16)}`).join("\n")}\n`);
  else if (command === "domain.inspect") process.stdout.write(`domain=${data.definition.id}\nprovenance=${data.definition.provenance.kind}\nhash=${data.hash}\nparameters=${Object.keys(data.definition.parameters).join(",")}\n`);
  else if (command === "calibration.list") process.stdout.write(`${data.calibrations.map((calibration: any) => `${calibration.definition.id}\t${calibration.definition.provenance.kind}\t${calibration.hash.slice(0, 16)}`).join("\n")}\n`);
  else if (command === "calibration.inspect") process.stdout.write(`calibration=${data.definition.id}\nprovenance=${data.definition.provenance.kind}\nhash=${data.hash}\nsources=${data.definition.sources.length}\nparameters=${Object.keys(data.definition.parameters).join(",")}\n`);
  else if (command === "calibrate") process.stdout.write(`calibration_run=${data.calibrationRunId}\nprofile=${data.profileId}\nfit_loss=${data.fit.loss}\nvalidation_loss=${data.validation.loss}\nartifact=${data.artifactPath}\n`);
  else if (command === "calibration.promote") process.stdout.write(`calibration_run=${data.run}\nprofile=${data.profile.id}\nhash=${data.hash}\npath=${data.path}\n`);
  else if (command === "controller.inspect") process.stdout.write(`controller=${data.definition.id}\nkind=${data.definition.kind}\nhash=${data.hash}\ncompatible=${data.compatibleAssemblies.join(",") || "none"}\nincompatible=${data.incompatibleAssemblies.length}\n`);
  else if (command === "assembly.compare") process.stdout.write(`Assembly ${data.from.id} -> ${data.to.id}\ncomponents +${data.components.added.length} -${data.components.removed.length} ~${data.components.changed.length}\nobservations +${data.observations.added.length} -${data.observations.removed.length}\nmass_delta_kg=${data.massDeltaKg}\ncost_delta=${data.costDelta}\n`);
  else if (command === "simulate") process.stdout.write(`run=${data.runId}\nscore=${data.score.total}\nsurvival=${data.metrics.survivalRate}\nartifact=${data.artifactPath}\n`);
  else if (command === "studio") process.stdout.write(`studio=${data.id}\nrun=${data.selectedRun ?? "none"}\nopen=${data.indexPath}\n`);
  else if (command === "hardware.export") process.stdout.write(`bundle=${data.id}\nhash=${data.bundleHash}\nstatus=${data.verificationStatus}\nartifact=${data.path}\n`);
  else if (command === "hardware.verify") process.stdout.write(`verification=${data.id}\nstatus=${data.status}\nhardware_verified=${data.hardwareVerified}\nartifact=${data.path}\n`);
  else if (command === "capture.list") process.stdout.write(`${[
    ...data.plans.map((plan: any) => `plan\t${plan.definition.id}\t${plan.definition.target}\t${plan.hash.slice(0, 16)}`),
    ...data.captures.map((capture: any) => `capture\t${capture.id}\t${capture.status}\teligible=${capture.calibrationEligible}`),
  ].join("\n")}\n`);
  else if (command === "capture.inspect") process.stdout.write(data.definition
    ? `plan=${data.definition.id}\ntarget=${data.definition.target}\nbundle=${data.definition.bundle}\nepisodes=${data.definition.episodes.length}\nhash=${data.hash}\n`
    : `capture=${data.manifest.id}\nstatus=${data.manifest.status}\nenvironment=${data.manifest.environment}\ncalibration_eligible=${data.manifest.calibrationEligible}\npath=${data.path}\n`);
  else if (command === "capture.run") process.stdout.write(`capture=${data.captureId}\nstatus=${data.status}\nenvironment=${data.environment}\nepisodes=${data.episodes.filter((episode: any) => episode.completed).length}/${data.episodes.length}\ncalibration_eligible=${data.calibrationEligible}\nartifact=${data.artifactPath}\n`);
  else if (command === "train") process.stdout.write(`training_run=${data.trainingRunId}\npolicy=${data.policyId}\nsteps=${data.trainingMetrics.totalSteps}\nartifact=${data.policyPath}\n`);
  else if (command === "policy.requalify") process.stdout.write(`policy=${data.id}\nsource=${data.sourcePolicyId}\nassembly=${data.assembly}\nartifact=${data.path}\n`);
  else if (command === "evaluate") process.stdout.write(`benchmark=${data.benchmark}\nscore=${data.evaluation.aggregateScore}\nlock=${data.lockHash}\n`);
  else if (command === "diagnose") {
    const worst = data.cases[0]; const violationLines = worst?.violations.map((gate: any) => `${gate.id}: ${gate.metric}=${gate.value} ${gate.comparator} ${gate.threshold} margin=${gate.margin}`).join("\n") ?? ""; const hypotheses = worst?.hypotheses.map((item: any) => `hypothesis[${item.surface}]=${item.description}`).join("\n") ?? "";
    process.stdout.write(`benchmark=${data.benchmark}\nstatus=${data.status}\nscore=${data.aggregateScore}\ndelta=${data.aggregateDelta}\nviolations=${data.violationCount}\nworst_case=${data.worstCase ?? "none"}\n${violationLines}${violationLines ? "\n" : ""}${hypotheses}${hypotheses ? "\n" : ""}${worst ? `reproduce=mujica ${worst.reproduceArgv.map((value: string) => JSON.stringify(value)).join(" ")}\n` : ""}`);
  }
  else if (command.startsWith("candidate")) process.stdout.write(`candidate=${data.candidate.id}\nbaseline_score=${data.baseline.aggregateScore}\ncandidate_score=${data.proposed.aggregateScore}\nscore_delta=${data.scoreDelta}\nverdict=${data.verdict}\n${data.revisionId ? `revision=${data.revisionId}\n` : ""}`);
  else if (command === "research") process.stdout.write(`research=${data.research}\ninitial_score=${data.initialScore}\nfinal_score=${data.finalScore}\nscore_delta=${data.scoreDelta}\niterations=${data.iterationsCompleted}\nexhausted=${data.exhausted}\nrevision_head=${data.revisionHead ?? "none"}\nledger=${data.ledgerPath}\n`);
  else if (command === "train-research") process.stdout.write(`training_research=${data.research}\ninitial_score=${data.initialScore}\nfinal_score=${data.finalScore}\nscore_delta=${data.scoreDelta}\niterations=${data.iterationsCompleted}\nexhausted=${data.exhausted}\npolicy_revision_head=${data.policyRevisionHead ?? "none"}\nledger=${data.ledgerPath}\n`);
  else if (command === "research.list") process.stdout.write(`${data.labs.map((lab: any) => `${lab.id}\t${lab.execution.kind}\t${lab.name}`).join("\n")}\n`);
  else if (command === "research.inspect") process.stdout.write(`lab=${data.lab.id}\nlane=${data.lab.execution.kind}\nbenchmark=${data.lab.benchmark}\nlock=${data.benchmarkLockHash}\nprogram=${data.programHash}\neditable=${data.lab.editable.paths.join(",")}\n`);
  else if (command === "research.status") process.stdout.write(`lab=${data.lab}\nsessions=${data.sessions.length}\nhead=${data.head?.id ?? "none"}\n`);
  else if (command === "research.run") process.stdout.write(`lab=${data.researchId}\nsession=${data.id}\ninitial_score=${data.initialScore}\nfinal_score=${data.finalScore}\nscore_delta=${data.scoreDelta}\niterations=${data.iterationsCompleted}\nledger=${data.ledgerPath}\n`);
  else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const args = [...argv]; const command = args.shift();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    if (args.includes("--json")) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command: "help", context: { scope: "global" }, data: { commands: CAPABILITIES, exitCodes: { success: 0, failure: 1, usage: 2 } }, diagnostics: [], artifacts: [], nextActions: [] })}\n`);
    else process.stdout.write(HELP);
    return;
  }
  let commandId = command; const wantsJson = args.includes("--json");
  try {
    let envelope: any;
    if (command === "validate" || command === "inspect" || command === "policies" || command === "revisions" || command === "policy-revisions" || command === "studio") {
      const { values, positionals } = parseArgs({ args, options: { run: { type: "string" }, "compare-run": { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica ${command} <project>`), values.project);
      envelope = command === "validate" ? await validateCommand(project) : command === "inspect" ? await inspectCommand(project) : command === "policies" ? await policiesCommand(project) : command === "policy-revisions" ? await policyRevisionsCommand(project) : command === "studio" ? await studioCommand(project, values.run, values["compare-run"]) : await revisionsCommand(project);
    } else if (command === "component") {
      const action = args.shift(); commandId = `component.${action}`; const { values, positionals } = parseArgs({ args, options: { component: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica component ${action} <project>`), values.project);
      if (action === "list") envelope = await componentListCommand(project); else if (action === "inspect") envelope = await componentInspectCommand(project, required(values.component, "component")); else throw new Error("Usage: mujica component list|inspect ...");
    } else if (command === "domain") {
      const action = args.shift(); commandId = `domain.${action}`; const { values, positionals } = parseArgs({ args, options: { domain: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica domain ${action} <project>`), values.project);
      if (action === "list") envelope = await domainListCommand(project); else if (action === "inspect") envelope = await domainInspectCommand(project, required(values.domain, "domain")); else throw new Error("Usage: mujica domain list|inspect ...");
    } else if (command === "driver") {
      const action = args.shift(); commandId = `driver.${action}`; const { values, positionals } = parseArgs({ args, options: { driver: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica driver ${action} <project>`), values.project);
      if (action === "list") envelope = await driverListCommand(project); else if (action === "inspect") envelope = await driverInspectCommand(project, required(values.driver, "driver")); else throw new Error("Usage: mujica driver list|inspect ...");
    } else if (command === "calibration") {
      const action = args.shift(); commandId = `calibration.${action}`; const { values, positionals } = parseArgs({ args, options: { calibration: { type: "string" }, run: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica calibration ${action} <project>`), values.project);
      if (action === "list") envelope = await calibrationListCommand(project); else if (action === "inspect") envelope = await calibrationInspectCommand(project, required(values.calibration, "calibration")); else if (action === "promote") envelope = await calibrationPromoteCommand(project, required(values.run, "run")); else throw new Error("Usage: mujica calibration list|inspect|promote ...");
    } else if (command === "calibrate") {
      const { values, positionals } = parseArgs({ args, options: { calibration: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica calibrate <project>"), values.project);
      envelope = await calibrateCommand(project, required(values.calibration, "calibration"));
    } else if (command === "controller") {
      const action = args.shift(); commandId = `controller.${action}`; const { values, positionals } = parseArgs({ args, options: { controller: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica controller ${action} <project>`), values.project);
      if (action === "list") envelope = await controllerListCommand(project); else if (action === "inspect") envelope = await controllerInspectCommand(project, required(values.controller, "controller")); else throw new Error("Usage: mujica controller list|inspect ...");
    } else if (command === "assembly") {
      const action = args.shift(); commandId = `assembly.${action}`; const { values, positionals } = parseArgs({ args, options: { assembly: { type: "string" }, from: { type: "string" }, to: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica assembly ${action} <project>`), values.project);
      if (action === "compile") envelope = await assemblyCompileCommand(project, required(values.assembly, "assembly")); else if (action === "inspect") envelope = await assemblyInspectCommand(project, required(values.assembly, "assembly")); else if (action === "compare") envelope = await assemblyCompareCommand(project, required(values.from, "from"), required(values.to, "to")); else throw new Error("Usage: mujica assembly inspect|compile|compare ...");
    } else if (command === "simulate") {
      const { values, positionals } = parseArgs({ args, options: { assembly: { type: "string" }, controller: { type: "string" }, task: { type: "string" }, scenario: { type: "string" }, objective: { type: "string" }, seed: { type: "string", default: "42" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica simulate <project>"), values.project);
      envelope = await simulateCommand(project, { assembly: required(values.assembly, "assembly"), controller: required(values.controller, "controller"), task: required(values.task, "task"), scenario: required(values.scenario, "scenario"), ...(values.objective ? { objective: values.objective } : {}), seed: Number(values.seed) });
    } else if (command === "hardware") {
      const action = args.shift(); commandId = `hardware.${action}`; const { values, positionals } = parseArgs({ args, options: { target: { type: "string" }, bundle: { type: "string" }, evidence: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica hardware ${action} <project>`), values.project);
      if (action === "export") envelope = await hardwareExportCommand(project, required(values.target, "target")); else if (action === "verify") envelope = await hardwareVerifyCommand(project, required(values.bundle, "bundle"), required(values.evidence, "evidence")); else throw new Error("Usage: mujica hardware export|verify ...");
    } else if (command === "capture") {
      const action = args.shift(); commandId = `capture.${action}`;
      const { values, positionals } = parseArgs({ args, options: { plan: { type: "string" }, capture: { type: "string" }, driver: { type: "string" }, operator: { type: "string" }, "driver-arg": { type: "string", multiple: true, default: [] }, "driver-input": { type: "string", multiple: true, default: [] }, authorization: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true });
      const project = await resolveProjectDirectory(one(positionals, `mujica capture ${action} <project>`), values.project);
      if (action === "list") envelope = await hardwareCapturePlanListCommand(project);
      else if (action === "inspect") {
        if (Boolean(values.plan) === Boolean(values.capture)) throw new Error("Usage: mujica capture inspect <project> (--plan ID | --capture ID)");
        envelope = values.plan ? await hardwareCapturePlanInspectCommand(project, values.plan) : await hardwareCaptureInspectCommand(project, values.capture!);
      }
      else if (action === "run") envelope = await hardwareCaptureCommand(project, required(values.plan, "plan"), values.driver, values["driver-arg"], values["driver-input"], required(values.operator, "operator"), values.authorization);
      else throw new Error("Usage: mujica capture list|inspect|run ...");
    } else if (command === "train") {
      const { values, positionals } = parseArgs({ args, options: { training: { type: "string" }, seed: { type: "string", default: "42" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica train <project>"), values.project); envelope = await trainCommand(project, required(values.training, "training"), Number(values.seed));
    } else if (command === "train-research") {
      const { values, positionals } = parseArgs({ args, options: { research: { type: "string" }, iterations: { type: "string", default: "1" }, "agent-command": { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica train-research <project>"), values.project); envelope = await trainingResearchCommand(project, required(values.research, "research"), Number(values.iterations), values["agent-command"]);
    } else if (command === "policy" || command === "revision" || command === "policy-revision") {
      const action = args.shift(); commandId = `${command}.${action}`; if (action !== "inspect" && !(command === "policy" && action === "requalify")) throw new Error(`Usage: mujica ${command} inspect ...`); const options = command === "policy" ? { policy: { type: "string" as const }, assembly: { type: "string" as const }, json: { type: "boolean" as const, default: false }, project: { type: "string" as const } } : { revision: { type: "string" as const }, json: { type: "boolean" as const, default: false }, project: { type: "string" as const } }; const { values, positionals } = parseArgs({ args, options, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, `mujica ${command} ${action} <project>`), values.project); envelope = command === "policy" && action === "requalify" ? await policyRequalifyCommand(project, required((values as any).policy, "policy"), required((values as any).assembly, "assembly")) : command === "policy" ? await policyInspectCommand(project, required((values as any).policy, "policy")) : command === "policy-revision" ? await policyRevisionInspectCommand(project, required((values as any).revision, "revision")) : await revisionInspectCommand(project, required((values as any).revision, "revision"));
    } else if (command === "benchmark") {
      const action = args.shift(); commandId = `benchmark.${action}`; if (action !== "lock") throw new Error("Usage: mujica benchmark lock ..."); const { values, positionals } = parseArgs({ args, options: { benchmark: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica benchmark lock <project>"), values.project); envelope = await benchmarkLockCommand(project, required(values.benchmark, "benchmark"));
    } else if (command === "evaluate") {
      const { values, positionals } = parseArgs({ args, options: { assembly: { type: "string" }, controller: { type: "string" }, benchmark: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica evaluate <project>"), values.project); envelope = await evaluateCommand(project, { assembly: required(values.assembly, "assembly"), controller: required(values.controller, "controller"), benchmark: required(values.benchmark, "benchmark") });
    } else if (command === "diagnose") {
      const { values, positionals } = parseArgs({ args, options: { assembly: { type: "string" }, controller: { type: "string" }, benchmark: { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica diagnose <project>"), values.project); envelope = await diagnoseCommand(project, { assembly: required(values.assembly, "assembly"), controller: required(values.controller, "controller"), benchmark: required(values.benchmark, "benchmark") });
    } else if (command === "candidate") {
      const { values, positionals } = parseArgs({ args, options: { candidate: { type: "string" }, apply: { type: "boolean", default: false }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica candidate <project>"), values.project); envelope = await candidateCommand(project, required(values.candidate, "candidate"), values.apply);
    } else if (command === "research") {
      const action = ["list", "inspect", "status", "run"].includes(args[0] ?? "") ? args.shift() : null;
      if (action) {
        commandId = `research.${action}`;
        const { values, positionals } = parseArgs({ args, options: { lab: { type: "string" }, iterations: { type: "string", default: "1" }, "agent-command": { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true });
        const project = await resolveProjectDirectory(one(positionals, `mujica research ${action} <project>`), values.project);
        if (action === "list") envelope = await researchLabListCommand(project);
        else if (action === "inspect") envelope = await researchLabInspectCommand(project, required(values.lab, "lab"));
        else if (action === "status") envelope = await researchLabStatusCommand(project, required(values.lab, "lab"));
        else envelope = await researchLabRunCommand(project, required(values.lab, "lab"), Number(values.iterations), required(values["agent-command"], "agent-command"));
      } else {
        const { values, positionals } = parseArgs({ args, options: { research: { type: "string" }, iterations: { type: "string", default: "1" }, "agent-command": { type: "string" }, json: { type: "boolean", default: false }, project: { type: "string" } }, allowPositionals: true }); const project = await resolveProjectDirectory(one(positionals, "mujica research <project>"), values.project); envelope = await researchCommand(project, required(values.research, "research"), Number(values.iterations), values["agent-command"]);
      }
    } else throw new Error(`Unknown command '${command}'\n\n${HELP}`);
    if (wantsJson) process.stdout.write(`${JSON.stringify(envelope)}\n`); else printHuman(commandId, envelope.data);
  } catch (error) {
    const envelope = failure(commandId, error); if (wantsJson) process.stderr.write(`${JSON.stringify(envelope)}\n`); else process.stderr.write(`mujica: ${envelope.error.message}\n`); process.exitCode = error instanceof TypeError || (error instanceof Error && error.message.startsWith("Usage:")) ? 2 : 1;
  }
}

if (import.meta.main) await run();
