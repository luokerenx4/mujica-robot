import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { atomicDirectory, compileAssembly, hashJson, listAssemblyIds, listComponentIds, loadComponent, loadProject, sha256, writeJson } from "@mujica/core";

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function artifactManifests(root: string): Promise<unknown[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: Array<Record<string, any>> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "manifest.json");
    if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(path)) values.push(JSON.parse(await readFile(path, "utf8")));
  }
  return values;
}

async function definitions(root: string, suffix: string): Promise<unknown[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: unknown[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) if (entry.isFile() && entry.name.endsWith(suffix)) values.push(JSON.parse(await readFile(join(root, entry.name), "utf8")));
  return values;
}

async function candidateDefinitions(root: string): Promise<unknown[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: unknown[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "candidate.json");
    if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(path)) values.push(JSON.parse(await readFile(path, "utf8")));
  }
  return values;
}

async function researchLabDefinitions(root: string): Promise<Array<Record<string, any>>> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: Array<Record<string, any>> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "research.json");
    if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(path)) values.push(JSON.parse(await readFile(path, "utf8")));
  }
  return values;
}

async function researchSessions(root: string): Promise<Array<Record<string, any>>> {
  if (!(await exists(root))) return [];
  const labs = await readdir(root, { withFileTypes: true }); const values: Array<Record<string, any>> = [];
  for (const lab of labs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!lab.isDirectory() || lab.isSymbolicLink()) continue;
    const sessionsRoot = join(root, lab.name, "sessions");
    if (!(await exists(sessionsRoot))) continue;
    const sessions = await readdir(sessionsRoot, { withFileTypes: true });
    for (const session of sessions.sort((a, b) => a.name.localeCompare(b.name))) {
      const sessionRoot = join(sessionsRoot, session.name); const manifestPath = join(sessionRoot, "manifest.json");
      if (!session.isDirectory() || session.isSymbolicLink() || !(await exists(manifestPath))) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")); const experiments = [];
      const experimentsRoot = join(sessionRoot, "experiments");
      if (await exists(experimentsRoot)) {
        const entries = await readdir(experimentsRoot, { withFileTypes: true });
        for (const experiment of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          const path = join(experimentsRoot, experiment.name, "manifest.json");
          if (experiment.isDirectory() && !experiment.isSymbolicLink() && await exists(path)) experiments.push(JSON.parse(await readFile(path, "utf8")));
        }
      }
      values.push({ ...manifest, experiments });
    }
  }
  return values;
}

async function sampledNdjson(path: string, maximum: number): Promise<{ rows: unknown[]; total: number; stride: number }> {
  if (!(await exists(path))) return { rows: [], total: 0, stride: 1 };
  const reader = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let rows: unknown[] = []; let total = 0; let stride = 1; let last: unknown;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const value = JSON.parse(line); last = value;
    if (total % stride === 0) rows.push(value);
    total++;
    if (rows.length > maximum) { stride *= 2; rows = rows.filter((_, index) => index % 2 === 0); }
  }
  if (last !== undefined && rows.at(-1) !== last) rows.push(last);
  return { rows, total, stride };
}

async function selectedRun(root: string, requested?: string) {
  const manifests = await artifactManifests(join(root, "runs")) as Array<Record<string, unknown>>;
  if (!manifests.length) return { summaries: [], selected: null };
  const id = requested ?? String(manifests.at(-1)?.id);
  if (!manifests.some((item) => item.id === id)) throw new Error(`Unknown completed run '${id}'`);
  const directory = join(root, "runs", id);
  const readOptional = async (name: string) => await exists(join(directory, name)) ? JSON.parse(await readFile(join(directory, name), "utf8")) : null;
  return {
    summaries: manifests,
    selected: {
      id, manifest: await readOptional("manifest.json"), metrics: await readOptional("metrics.json"), score: await readOptional("score.json"),
      events: await sampledNdjson(join(directory, "events.ndjson"), 5_000), trajectory: await sampledNdjson(join(directory, "trajectory.ndjson"), 2_000),
    },
  };
}

type ReplayInput = { path: string; manifest: Record<string, any> };

async function validateReplayInput(replay: ReplayInput): Promise<void> {
  const root = resolve(replay.path); const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Visual replay path must be a real directory");
  const diskManifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (hashJson(diskManifest) !== hashJson(replay.manifest)) throw new Error("Visual replay manifest differs from the immutable cache");
  const count = Number(replay.manifest.frameCount);
  if (!Number.isInteger(count) || count < 1 || replay.manifest.framePattern !== "frames/%06d.png") throw new Error("Visual replay frame contract is invalid");
  const frameRoot = join(root, "frames"); const frameStat = await lstat(frameRoot);
  if (!frameStat.isDirectory() || frameStat.isSymbolicLink()) throw new Error("Visual replay frame path must be a real directory");
  const expected = Array.from({ length: count }, (_, index) => `${String(index).padStart(6, "0")}.png`);
  const actual = (await readdir(frameRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  if (hashJson(actual) !== hashJson(expected)) throw new Error("Visual replay frame cache is incomplete");
  if (!Array.isArray(replay.manifest.frameHashes) || replay.manifest.frameHashes.length !== count) throw new Error("Visual replay frame integrity record is incomplete");
  const actualHashes = await Promise.all(expected.map(async (name) => sha256(await readFile(join(frameRoot, name)))));
  if (hashJson(actualHashes) !== hashJson(replay.manifest.frameHashes)) throw new Error("Visual replay frame cache failed integrity verification");
}

async function verifyReplayForRun(replay: ReplayInput | undefined, run: Awaited<ReturnType<typeof selectedRun>>["selected"], label: string): Promise<void> {
  if (!replay) return;
  await validateReplayInput(replay);
  if (!run) throw new Error(`A ${label} visual replay requires a selected completed Run`);
  if (replay.manifest.runId !== run.id) throw new Error(`${label} visual replay Run id does not match the selected Run`);
  if (replay.manifest.resultHash !== run.manifest?.resultHash) throw new Error(`${label} visual replay result hash does not match the selected Run`);
  if (replay.manifest.completed !== true) throw new Error(`${label} visual replay is incomplete`);
}

export async function buildStudioSnapshot(projectDirectory: string, options: { run?: string; replay?: ReplayInput; compareRun?: string; compareReplay?: ReplayInput } = {}) {
  const project = await loadProject(projectDirectory); const assemblies = [];
  for (const id of await listAssemblyIds(project.rootDir)) {
    const assembly = await compileAssembly(project.rootDir, id);
    assemblies.push({
      id, name: assembly.name, hash: assembly.assemblyHash, totalMassKg: assembly.totalMassKg, componentCost: assembly.componentCost,
      components: assembly.components, observationContract: assembly.observationContract, actionContract: assembly.actionContract,
    });
  }
  const components = [];
  for (const id of await listComponentIds(project.rootDir)) { const component = await loadComponent(project.rootDir, id); components.push({ ...component.manifest, hash: component.hash }); }
  const runs = await selectedRun(project.rootDir, options.run);
  const comparison = options.compareRun ? await selectedRun(project.rootDir, options.compareRun) : { summaries: runs.summaries, selected: null };
  if (options.compareReplay && !options.compareRun) throw new Error("A comparison visual replay requires --compare-run");
  await verifyReplayForRun(options.replay, runs.selected, "primary");
  await verifyReplayForRun(options.compareReplay, comparison.selected, "comparison");
  return {
    version: 4, kind: "mujica-studio-snapshot", project: project.manifest,
    selectedAssembly: project.manifest.defaults.assembly, assemblies, components,
    runs: runs.summaries, selectedRun: runs.selected,
    selectedReplay: options.replay ? { ...options.replay.manifest, frameBase: "replay/frames" } : null,
    comparisonRun: comparison.selected,
    comparisonReplay: options.compareReplay ? { ...options.compareReplay.manifest, frameBase: "comparison-replay/frames" } : null,
    policies: await artifactManifests(join(project.rootDir, "policies")),
    trainingRuns: await artifactManifests(join(project.rootDir, "training-runs")),
    hardwareBundles: await artifactManifests(join(project.rootDir, "hardware-bundles")),
    hardwareVerifications: await artifactManifests(join(project.rootDir, "hardware-verifications")),
    benchmarks: await definitions(join(project.rootDir, "benchmarks"), ".benchmark.json"),
    candidates: await candidateDefinitions(join(project.rootDir, "candidates")),
    revisions: await artifactManifests(join(project.rootDir, "revisions")),
    policyRevisions: await artifactManifests(join(project.rootDir, "policy-revisions")),
    researchLabs: await researchLabDefinitions(join(project.rootDir, "research")),
    researchSessions: await researchSessions(join(project.rootDir, "research-runs")),
  };
}

function studioHtml(snapshot: Awaited<ReturnType<typeof buildStudioSnapshot>>): string {
  const data = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
  const title = snapshot.project.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:">
<title>Mujica Studio — ${title}</title>
<style>
:root{color-scheme:dark;--bg:#0b1015;--panel:#121a22;--line:#263442;--muted:#8ea0af;--text:#edf4f8;--a:#65d6ad;--b:#efc66b;--bad:#ff7b72}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}header{padding:22px 28px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:20px}h1,h2,h3{margin:0 0 10px;font-weight:600}h1{font-size:20px}h2{font-size:15px;color:var(--a)}h3{font-size:13px}.muted{color:var(--muted)}main{display:grid;grid-template-columns:minmax(360px,1.3fr) minmax(320px,.7fr);gap:14px;padding:14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;min-width:0}.wide{grid-column:1/-1}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.stat{border:1px solid var(--line);padding:10px;border-radius:6px}.stat strong{display:block;font-size:18px;color:var(--b)}select,input,button{font:inherit;color:var(--text);background:#0d151c;border:1px solid var(--line);border-radius:5px;padding:6px}button{cursor:pointer}button:hover{border-color:var(--a)}canvas{width:100%;height:300px;background:#090e12;border:1px solid var(--line);border-radius:6px}.controls{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.controls input{flex:1;min-width:160px}.split,.comparison-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.replay-card{min-width:0}.replay-card h3 .tag{float:right}.list{max-height:340px;overflow:auto}.row{padding:7px 0;border-bottom:1px solid var(--line);word-break:break-word}.row.seek{cursor:pointer}.row.seek:hover{background:#17232d}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:1px 7px;margin:2px;color:var(--muted)}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:5px;border-bottom:1px solid var(--line)}code{color:var(--b)}.replay-stage{position:relative;background:#05080b;border:1px solid var(--line);border-radius:7px;overflow:hidden;aspect-ratio:4/3;display:grid;place-items:center}.replay-stage img{display:block;width:100%;height:100%;object-fit:contain}.replay-stage .missing{padding:30px;text-align:center;color:var(--muted)}.live-badge{position:absolute;left:10px;top:10px;background:#07110dcc;border:1px solid var(--a);color:var(--a);border-radius:11px;padding:2px 8px}.telemetry{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.telemetry .cell{border:1px solid var(--line);border-radius:5px;padding:7px}.telemetry strong{display:block;color:var(--b);font-size:12px}.ok{color:var(--a)}.bad{color:var(--bad)}.delta-good{color:var(--a)}.delta-bad{color:var(--bad)}#copy-status{min-height:20px}@media(max-width:850px){main{grid-template-columns:1fr}.split,.comparison-grid{grid-template-columns:1fr}.wide{grid-column:1}}
</style></head><body><header><div><h1>Mujica Studio</h1><div>${title} · read-only evidence debugger</div></div><div class="muted">Source of truth: project files and immutable artifacts<br>No editing or evaluation occurs in Studio</div></header>
<main><section class="panel wide"><div class="stats" id="stats"></div></section>
<section class="panel wide"><h2>Authoritative MuJoCo replay comparison</h2><div class="comparison-grid"><div class="replay-card"><h3>Baseline <span class="tag">A</span></h3><div class="replay-stage"><img id="replay-image" alt="Baseline MuJoCo robot replay"><div class="missing" id="replay-missing">No authoritative visual replay.</div><span class="live-badge" id="health">—</span></div><div id="frame-a">—</div><div class="telemetry" id="telemetry-a"></div></div><div class="replay-card" id="comparison-card"><h3>Subject <span class="tag">B</span></h3><div class="replay-stage"><img id="comparison-image" alt="Subject MuJoCo robot replay"><div class="missing" id="comparison-missing">Choose --compare-run to add a subject.</div><span class="live-badge" id="comparison-health">—</span></div><div id="frame-b">—</div><div class="telemetry" id="telemetry-b"></div></div></div><div class="controls"><button id="previous" title="Previous shared time">◀</button><button id="play">Play</button><button id="next" title="Next shared time">▶</button><input id="scrub" type="range" min="0" value="0"><select id="speed" title="Playback speed"><option value=".25">0.25×</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div><div id="frame">—</div><div class="muted" id="replay-status"></div><div class="controls"><button id="copy-frame">Copy comparison context for Agent</button></div><div class="muted" id="copy-status"></div></section>
<section class="panel"><h2>Run evidence</h2><div id="run"></div></section>
<section class="panel"><h2>Top-down path</h2><canvas id="trajectory" width="900" height="420"></canvas><div class="muted" id="sampling"></div></section>
<section class="panel"><h2>Motion-quality deltas</h2><table id="metrics"></table><div class="muted">Delta is subject − baseline; lower is better for every quality burden.</div></section>
<section class="panel"><h2>Assembly and contracts</h2><select id="assembly"></select><div id="assembly-detail"></div></section>
<section class="panel"><h2>Event timeline</h2><div class="list" id="events"></div></section>
<section class="panel wide"><h2>Research Lab ledger</h2><div class="split"><div><h3>Source-governed Labs</h3><div class="list" id="research-labs"></div></div><div><h3>Immutable experiment Sessions</h3><div class="list" id="research-sessions"></div></div></div></section>
<section class="panel wide"><div class="split"><div><h2>Robot Revision lineage</h2><div class="list" id="revisions"></div></div><div><h2>Training and Policy artifacts</h2><div class="list" id="training"></div></div></div></section>
<section class="panel wide"><div class="split"><div><h2>Locked Benchmark definitions</h2><div class="list" id="benchmarks"></div></div><div><h2>Development Candidates</h2><div class="list" id="candidates"></div></div></div></section></main>
<script>const S=${data};const q=s=>document.querySelector(s), esc=v=>String(v??'—').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
if(false){const selected=S.selectedRun, replay=S.selectedReplay, trajectory=selected?.trajectory.rows??[], replayFrames=replay?.frameCount??trajectory.length;q('#stats').innerHTML=[['Assemblies',S.assemblies.length],['Components',S.components.length],['Runs',S.runs.length],['Rendered frames',replay?.frameCount??0],['Policies',S.policies.length],['Research Labs',S.researchLabs.length],['Experiments',S.researchSessions.reduce((n,s)=>n+s.experiments.length,0)],['Robot revisions',S.revisions.length]].map(x=>'<div class="stat"><strong>'+x[1]+'</strong>'+x[0]+'</div>').join('');
q('#run').innerHTML=selected?'<div class="row"><code>'+esc(selected.id)+'</code></div><div class="row">seed '+esc(selected.manifest?.seed)+' · result '+esc(selected.manifest?.resultHash?.slice?.(0,12))+'</div>'+(replay?'<div class="row">visual replay <code>'+esc(replay.id)+'</code></div>':''):'<div class="muted">No completed simulation run.</div>';const metric=selected?.metrics??{};q('#metrics').innerHTML=Object.entries(metric).filter(([,v])=>typeof v==='number'||typeof v==='string'||typeof v==='boolean').map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+esc(typeof v==='number'?Number(v).toFixed(4):v)+'</td></tr>').join('');
const sel=q('#assembly');sel.innerHTML=S.assemblies.map(a=>'<option '+(a.id===S.selectedAssembly?'selected':'')+' value="'+esc(a.id)+'">'+esc(a.id)+'</option>').join('');function showAssembly(){const a=S.assemblies.find(x=>x.id===sel.value);q('#assembly-detail').innerHTML='<div class="row">hash <code>'+esc(a.hash.slice(0,16))+'</code><br>mass '+a.totalMassKg.toFixed(3)+' kg · component cost '+a.componentCost+'</div><h3>Components</h3><div>'+a.components.map(c=>'<div class="row"><span class="tag">'+esc(c.componentId)+'</span> <code>'+esc(JSON.stringify(c.config||{}))+'</code></div>').join('')+'</div><h3>Observation '+a.observationContract.size+'</h3><div>'+a.observationContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div><h3>Action '+a.actionContract.size+'</h3><div>'+a.actionContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div>'}sel.onchange=showAssembly;showAssembly();
q('#events').innerHTML=(selected?.events.rows??[]).map((e,i)=>'<div class="row seek" data-event-index="'+i+'" title="Seek replay to this Event"><code>'+Number(e.time??0).toFixed(3)+'s</code> '+esc(e.type)+'<div class="muted">'+esc(JSON.stringify(e))+'</div></div>').join('')||'<div class="muted">No events.</div>';q('#revisions').innerHTML=S.revisions.map(r=>'<div class="row"><code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.parent??'root')+' → score '+esc(Number(r.aggregateScore).toFixed(4))+'</span></div>').join('');q('#training').innerHTML=S.policyRevisions.map(r=>'<div class="row">Policy revision <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('')+S.trainingRuns.slice(-8).map(r=>'<div class="row">Training <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('');
q('#research-labs').innerHTML=S.researchLabs.map(l=>'<div class="row"><code>'+esc(l.id)+'</code> <span class="tag">'+esc(l.execution.kind)+'</span><br><span class="muted">'+esc(l.benchmark)+' · editable '+l.editable.paths.map(esc).join(', ')+'</span></div>').join('')||'<div class="muted">No Research Labs.</div>';q('#research-sessions').innerHTML=S.researchSessions.slice().reverse().map(s=>'<div class="row"><code>'+esc(s.id)+'</code> <span class="tag">'+esc(s.completed?'COMPLETE':'INCOMPLETE')+'</span><br><span class="muted">'+esc(s.researchId)+' · '+s.iterationsCompleted+'/'+s.iterationsRequested+' experiments · score '+Number(s.initialScore).toFixed(4)+' → '+Number(s.finalScore).toFixed(4)+'</span>'+s.experiments.map(e=>'<div class="row"><span class="tag" style="color:'+(e.verdict==='KEEP'?'var(--a)':e.verdict==='REVERT'?'var(--b)':'var(--bad)')+'">'+esc(e.verdict)+'</span> <code>'+esc(e.id)+'</code> Δ '+Number(e.delta??0).toFixed(4)+'<br><span class="muted">'+esc(e.proposal?.hypothesis??'No proposal')+(e.decision?.gateReasons?.length?' · '+e.decision.gateReasons.map(esc).join(' · '):'')+'</span></div>').join('')+'</div>').join('')||'<div class="muted">No completed research Sessions.</div>';
q('#benchmarks').innerHTML=S.benchmarks.map(b=>'<div class="row"><code>'+esc(b.id)+'</code><br><span class="muted">'+esc(b.objective)+' · '+b.cases.length+' fixed cases · baseline '+esc(b.baseline.assembly)+'/'+esc(b.baseline.controller)+'</span></div>').join('');q('#candidates').innerHTML=S.candidates.map(c=>'<div class="row"><code>'+esc(c.id)+'</code> <span class="tag">'+esc(c.kind)+'</span><br><span class="muted">'+esc(c.baseline.assembly)+'/'+esc(c.baseline.controller)+' → '+esc(c.proposed.assembly)+'/'+esc(c.proposed.controller)+'</span></div>').join('');
const canvas=q('#trajectory'),ctx=canvas.getContext('2d'),scrub=q('#scrub'),frame=q('#frame'),image=q('#replay-image'),missing=q('#replay-missing'),health=q('#health');scrub.max=Math.max(0,replayFrames-1);let timer=null,currentFrame=0;
const pad=i=>String(i).padStart(6,'0'), vector=v=>Array.isArray(v)?v.map(x=>Number(x).toFixed(3)).join(', '):'—', nearest=(values,time)=>{let best=0,delta=Infinity;values.forEach((value,index)=>{const next=Math.abs(Number(value)-time);if(next<delta){delta=next;best=index}});return best}, frameTime=i=>replay?.frameTimes?.[i]??trajectory[i]?.time??0, trajectoryIndex=i=>trajectory.length?nearest(trajectory.map(row=>row.time),frameTime(i)):0, eventFrame=time=>replay?.frameTimes?.length?nearest(replay.frameTimes,Number(time)):trajectory.length?nearest(trajectory.map(row=>row.time),Number(time)):0;
function drawPath(index){ctx.clearRect(0,0,canvas.width,canvas.height);if(!trajectory.length){ctx.fillStyle='#8ea0af';ctx.fillText('No trajectory selected',30,40);return}const pts=trajectory.map(r=>[r.qpos?.[0]??0,r.qpos?.[1]??0]),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),span=Math.max(maxX-minX,maxY-minY,.25),map=p=>[60+(p[0]-minX)/span*(canvas.width-120),canvas.height-60-(p[1]-minY)/span*(canvas.height-120)];ctx.strokeStyle='#263442';ctx.lineWidth=1;for(let n=0;n<9;n++){let p=60+n*(canvas.width-120)/8;ctx.beginPath();ctx.moveTo(p,40);ctx.lineTo(p,canvas.height-40);ctx.stroke()}ctx.strokeStyle='#334756';ctx.lineWidth=2;ctx.beginPath();pts.forEach((p,n)=>{let m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();ctx.strokeStyle='#65d6ad';ctx.lineWidth=4;ctx.beginPath();pts.slice(0,index+1).forEach((p,n)=>{let m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();let m=map(pts[index]);ctx.fillStyle=trajectory[index].healthy===false?'#ff7b72':'#efc66b';ctx.beginPath();ctx.arc(...m,8,0,Math.PI*2);ctx.fill()}
function telemetry(row){const peak=Math.max(0,...(row?.action??[]).map(x=>Math.abs(Number(x))));const cells=[['Simulation time',Number(row?.time??0).toFixed(3)+' s'],['Step',row?.step??'—'],['Pitch',Number(row?.pitchRad??0).toFixed(3)+' rad'],['Body tilt',Number(row?.bodyTiltRad??0).toFixed(3)+' rad'],['Command',vector(row?.motionCommand)],['Measured motion',vector(row?.measuredMotion)],['Foot contact force',vector(row?.footContactForce)],['Peak applied action',peak.toFixed(3)]];q('#frame-telemetry').innerHTML=cells.map(x=>'<div class="cell"><strong>'+esc(x[0])+'</strong>'+esc(x[1])+'</div>').join('');health.textContent=row?.healthy===false?'UNHEALTHY':'HEALTHY';health.className='live-badge '+(row?.healthy===false?'bad':'ok')}
function render(i){currentFrame=Math.max(0,Math.min(replayFrames-1,Number(i)||0));const rowIndex=trajectoryIndex(currentFrame),row=trajectory[rowIndex];if(replay){image.hidden=false;missing.hidden=true;image.src=replay.frameBase+'/'+pad(currentFrame)+'.png';const preload=new Image();preload.src=replay.frameBase+'/'+pad(Math.min(replayFrames-1,currentFrame+1))+'.png'}else{image.hidden=true;missing.hidden=false}scrub.value=String(currentFrame);frame.textContent='rendered frame '+(currentFrame+1)+' / '+replayFrames+' · simulation step '+esc(row?.step)+' · '+Number(frameTime(currentFrame)).toFixed(3)+'s';telemetry(row);drawPath(rowIndex)}
function pause(){if(timer){clearTimeout(timer);timer=null}q('#play').textContent='Play'}function advance(){if(currentFrame>=replayFrames-1){pause();return}const from=frameTime(currentFrame),to=frameTime(currentFrame+1),speed=Number(q('#speed').value)||1;render(currentFrame+1);timer=setTimeout(advance,Math.max(8,1000*Math.max(.001,to-from)/speed))}q('#play').onclick=()=>{if(timer){pause();return}q('#play').textContent='Pause';advance()};q('#previous').onclick=()=>{pause();render(currentFrame-1)};q('#next').onclick=()=>{pause();render(currentFrame+1)};scrub.oninput=()=>{pause();render(Number(scrub.value))};
document.querySelectorAll('[data-event-index]').forEach(node=>node.onclick=()=>{pause();const event=selected.events.rows[Number(node.dataset.eventIndex)];render(eventFrame(event.time??0))});document.addEventListener('keydown',event=>{if(event.target?.matches?.('input,select,textarea'))return;if(event.key==='ArrowLeft'){event.preventDefault();q('#previous').click()}else if(event.key==='ArrowRight'){event.preventDefault();q('#next').click()}else if(event.key===' '){event.preventDefault();q('#play').click()}});
q('#copy-frame').onclick=async()=>{const row=trajectory[trajectoryIndex(currentFrame)]??null,events=(selected?.events.rows??[]).filter(event=>Math.abs(Number(event.time??0)-Number(row?.time??0))<=.011),context={kind:'mujica-frame-context',runId:selected?.id,resultHash:selected?.manifest?.resultHash,replayId:replay?.id??null,replayFrame:currentFrame,simulationStep:row?.step??null,timeSeconds:row?.time??null,healthy:row?.healthy??null,pitchRad:row?.pitchRad??null,bodyTiltRad:row?.bodyTiltRad??null,motionCommand:row?.motionCommand??null,measuredMotion:row?.measuredMotion??null,footContactForce:row?.footContactForce??null,action:row?.action??null,events};const text=JSON.stringify(context,null,2);try{await navigator.clipboard.writeText(text);q('#copy-status').textContent='Copied exact Run/frame context. Paste it to your Coding Agent.'}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();q('#copy-status').textContent='Copied frame context.'}};
q('#replay-status').textContent=replay?replay.renderer+' · MuJoCo '+replay.mujocoVersion+' · '+replay.frameCount+' exact qpos frames · '+replay.settings.width+'×'+replay.settings.height:'Generate this Run again with mujica studio to add an authoritative MuJoCo replay.';q('#sampling').textContent=selected?'trajectory '+selected.trajectory.total+' rows · displayed '+trajectory.length+' · stride '+selected.trajectory.stride:'';render(0);}

const A={run:S.selectedRun,replay:S.selectedReplay},B={run:S.comparisonRun,replay:S.comparisonReplay};
A.trajectory=A.run?.trajectory.rows??[];B.trajectory=B.run?.trajectory.rows??[];
const pad=i=>String(i).padStart(6,'0'),vector=v=>Array.isArray(v)?v.map(x=>Number(x).toFixed(3)).join(', '):'—';
const timesFor=side=>side.replay?.frameTimes?.length?side.replay.frameTimes.map(Number):side.trajectory.map(row=>Number(row.time??0));
A.times=timesFor(A);B.times=timesFor(B);
const clockTimes=[...new Set([...A.times,...B.times].map(time=>Number(time).toFixed(9)))].map(Number).sort((a,b)=>a-b);
if(!clockTimes.length)clockTimes.push(0);
const atOrBefore=(times,time)=>{let found=0;for(let i=0;i<times.length;i++){if(Number(times[i])<=time+1e-9)found=i;else break}return found};
const rowAt=(side,time)=>side.trajectory[atOrBefore(side.trajectory.map(row=>Number(row.time??0)),time)]??null;
const sideFrame=(side,time)=>side.times.length?atOrBefore(side.times,time):0;
q('#stats').innerHTML=[['Assemblies',S.assemblies.length],['Components',S.components.length],['Runs',S.runs.length],['Compared Runs',B.run?2:A.run?1:0],['Rendered frames',(A.replay?.frameCount??0)+(B.replay?.frameCount??0)],['Policies',S.policies.length],['Research Labs',S.researchLabs.length],['Robot revisions',S.revisions.length]].map(x=>'<div class="stat"><strong>'+x[1]+'</strong>'+x[0]+'</div>').join('');
const runEvidence=(label,side)=>side.run?'<div class="row"><span class="tag">'+label+'</span> <code>'+esc(side.run.id)+'</code></div><div class="row">seed '+esc(side.run.manifest?.seed)+' · result '+esc(side.run.manifest?.resultHash?.slice?.(0,12))+'</div>'+(side.replay?'<div class="row">replay <code>'+esc(side.replay.id)+'</code> · '+side.replay.frameCount+' frames</div>':''):'<div class="muted">'+label+' not selected.</div>';
q('#run').innerHTML=runEvidence('baseline',A)+runEvidence('subject',B);
const qualityKeys=['meanJointJerkRadPerSec3','meanBodyAngularJerkRadPerSec3','meanActionSlewRatePerSec','actuatorSaturationRate','meanFootSlipSpeedMps','peakFootContactImpactNPerSec','totalFootSlipDistanceM'];
q('#metrics').innerHTML='<tr><th>Metric</th><th>A</th><th>B</th><th>Δ</th></tr>'+qualityKeys.map(key=>{const a=Number(A.run?.metrics?.[key]),b=Number(B.run?.metrics?.[key]),hasA=Number.isFinite(a),hasB=Number.isFinite(b),delta=b-a;return '<tr><td>'+esc(key)+'</td><td>'+esc(hasA?a.toFixed(4):'—')+'</td><td>'+esc(hasB?b.toFixed(4):'—')+'</td><td class="'+(hasA&&hasB?(delta<=0?'delta-good':'delta-bad'):'')+'">'+esc(hasA&&hasB?(delta>=0?'+':'')+delta.toFixed(4):'—')+'</td></tr>'}).join('');
const sel=q('#assembly');sel.innerHTML=S.assemblies.map(a=>'<option '+(a.id===S.selectedAssembly?'selected':'')+' value="'+esc(a.id)+'">'+esc(a.id)+'</option>').join('');
function showAssembly(){const a=S.assemblies.find(x=>x.id===sel.value);q('#assembly-detail').innerHTML='<div class="row">hash <code>'+esc(a.hash.slice(0,16))+'</code><br>mass '+a.totalMassKg.toFixed(3)+' kg · component cost '+a.componentCost+'</div><h3>Components</h3><div>'+a.components.map(c=>'<div class="row"><span class="tag">'+esc(c.componentId)+'</span> <code>'+esc(JSON.stringify(c.config||{}))+'</code></div>').join('')+'</div><h3>Observation '+a.observationContract.size+'</h3><div>'+a.observationContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div><h3>Action '+a.actionContract.size+'</h3><div>'+a.actionContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div>'}sel.onchange=showAssembly;showAssembly();
const eventRows=[...(A.run?.events.rows??[]).map(event=>({side:'A',event})),...(B.run?.events.rows??[]).map(event=>({side:'B',event}))].sort((a,b)=>Number(a.event.time??0)-Number(b.event.time??0));
q('#events').innerHTML=eventRows.map((item,index)=>'<div class="row seek" data-event-index="'+index+'"><span class="tag">'+item.side+'</span> <code>'+Number(item.event.time??0).toFixed(3)+'s</code> '+esc(item.event.type)+'<div class="muted">'+esc(JSON.stringify(item.event))+'</div></div>').join('')||'<div class="muted">No events.</div>';
q('#revisions').innerHTML=S.revisions.map(r=>'<div class="row"><code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.parent??'root')+' → score '+esc(Number(r.aggregateScore).toFixed(4))+'</span></div>').join('');
q('#training').innerHTML=S.policyRevisions.map(r=>'<div class="row">Policy revision <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('')+S.trainingRuns.slice(-8).map(r=>'<div class="row">Training <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('');
q('#research-labs').innerHTML=S.researchLabs.map(l=>'<div class="row"><code>'+esc(l.id)+'</code> <span class="tag">'+esc(l.execution.kind)+'</span><br><span class="muted">'+esc(l.benchmark)+' · editable '+l.editable.paths.map(esc).join(', ')+'</span></div>').join('')||'<div class="muted">No Research Labs.</div>';
q('#research-sessions').innerHTML=S.researchSessions.slice().reverse().map(s=>'<div class="row"><code>'+esc(s.id)+'</code> <span class="tag">'+esc(s.completed?'COMPLETE':'INCOMPLETE')+'</span><br><span class="muted">'+esc(s.researchId)+' · '+s.iterationsCompleted+'/'+s.iterationsRequested+' experiments · score '+Number(s.initialScore).toFixed(4)+' → '+Number(s.finalScore).toFixed(4)+'</span></div>').join('')||'<div class="muted">No completed research Sessions.</div>';
q('#benchmarks').innerHTML=S.benchmarks.map(b=>'<div class="row"><code>'+esc(b.id)+'</code><br><span class="muted">'+esc(b.objective)+' · '+b.cases.length+' fixed cases · baseline '+esc(b.baseline.assembly)+'/'+esc(b.baseline.controller)+'</span></div>').join('');
q('#candidates').innerHTML=S.candidates.map(c=>'<div class="row"><code>'+esc(c.id)+'</code> <span class="tag">'+esc(c.kind)+'</span><br><span class="muted">'+esc(c.baseline.assembly)+'/'+esc(c.baseline.controller)+' → '+esc(c.proposed.assembly)+'/'+esc(c.proposed.controller)+'</span></div>').join('');
const canvas=q('#trajectory'),ctx=canvas.getContext('2d'),scrub=q('#scrub');scrub.max=String(Math.max(0,clockTimes.length-1));let timer=null,currentClock=0;
function drawPath(time){ctx.clearRect(0,0,canvas.width,canvas.height);const series=[{side:A,color:'#65d6ad'},{side:B,color:'#efc66b'}].filter(item=>item.side.trajectory.length);if(!series.length){ctx.fillStyle='#8ea0af';ctx.fillText('No trajectory selected',30,40);return}const all=series.flatMap(item=>item.side.trajectory.map(row=>[row.qpos?.[0]??0,row.qpos?.[1]??0])),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),span=Math.max(maxX-minX,maxY-minY,.25),map=p=>[60+(p[0]-minX)/span*(canvas.width-120),canvas.height-60-(p[1]-minY)/span*(canvas.height-120)];for(const item of series){const pts=item.side.trajectory.map(r=>[r.qpos?.[0]??0,r.qpos?.[1]??0]),index=atOrBefore(item.side.trajectory.map(row=>Number(row.time??0)),time);ctx.strokeStyle=item.color+'55';ctx.lineWidth=2;ctx.beginPath();pts.forEach((p,n)=>{const m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();ctx.strokeStyle=item.color;ctx.lineWidth=4;ctx.beginPath();pts.slice(0,index+1).forEach((p,n)=>{const m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();const m=map(pts[index]);ctx.fillStyle=item.color;ctx.beginPath();ctx.arc(...m,7,0,Math.PI*2);ctx.fill()}}
function telemetry(side,row,target,health){const quality=row?.motionQuality??{},peak=values=>Array.isArray(values)?Math.max(0,...values.map(x=>Math.abs(Number(x)))):null,cells=[['Time',Number(row?.time??0).toFixed(3)+' s'],['Step',row?.step??'—'],['Pitch',Number(row?.pitchRad??0).toFixed(3)+' rad'],['Body tilt',Number(row?.bodyTiltRad??0).toFixed(3)+' rad'],['Command',vector(row?.motionCommand)],['Measured',vector(row?.measuredMotion)],['Action slew peak',peak(quality.actionSlewRatePerSec)?.toFixed(2)??'—'],['Joint jerk peak',peak(quality.jointJerkRadPerSec3)?.toFixed(2)??'—'],['Foot slip peak',peak(quality.footSlipSpeedMps)?.toFixed(3)??'—'],['Contact impact peak',peak(quality.footContactImpactNPerSec)?.toFixed(1)??'—']];q(target).innerHTML=cells.map(x=>'<div class="cell"><strong>'+esc(x[0])+'</strong>'+esc(x[1])+'</div>').join('');q(health).textContent=row?.healthy===false?'UNHEALTHY':row?'HEALTHY':'—';q(health).className='live-badge '+(row?.healthy===false?'bad':'ok')}
function renderSide(side,time,imageId,missingId,frameId,telemetryId,healthId){const image=q(imageId),missing=q(missingId),frameIndex=sideFrame(side,time),row=rowAt(side,time);if(side.replay){image.hidden=false;missing.hidden=true;image.src=side.replay.frameBase+'/'+pad(frameIndex)+'.png';const preload=new Image();preload.src=side.replay.frameBase+'/'+pad(Math.min(side.replay.frameCount-1,frameIndex+1))+'.png'}else{image.hidden=true;missing.hidden=false}q(frameId).textContent=side.run?'frame '+(frameIndex+1)+' / '+Math.max(1,side.times.length)+' · mapped '+Number(side.times[frameIndex]??row?.time??0).toFixed(3)+'s':'No Run selected';telemetry(side,row,telemetryId,healthId);return {frameIndex,row}}
function render(index){currentClock=Math.max(0,Math.min(clockTimes.length-1,Number(index)||0));const time=clockTimes[currentClock],a=renderSide(A,time,'#replay-image','#replay-missing','#frame-a','#telemetry-a','#health'),b=renderSide(B,time,'#comparison-image','#comparison-missing','#frame-b','#telemetry-b','#comparison-health');scrub.value=String(currentClock);q('#frame').textContent='shared simulation time '+time.toFixed(3)+'s · '+(currentClock+1)+' / '+clockTimes.length;drawPath(time);return {time,a,b}}
function pause(){if(timer){clearTimeout(timer);timer=null}q('#play').textContent='Play'}function advance(){if(currentClock>=clockTimes.length-1){pause();return}const from=clockTimes[currentClock],to=clockTimes[currentClock+1],speed=Number(q('#speed').value)||1;render(currentClock+1);timer=setTimeout(advance,Math.max(8,1000*Math.max(.001,to-from)/speed))}
q('#play').onclick=()=>{if(timer){pause();return}q('#play').textContent='Pause';advance()};q('#previous').onclick=()=>{pause();render(currentClock-1)};q('#next').onclick=()=>{pause();render(currentClock+1)};scrub.oninput=()=>{pause();render(Number(scrub.value))};
document.querySelectorAll('[data-event-index]').forEach(node=>node.onclick=()=>{pause();const time=Number(eventRows[Number(node.dataset.eventIndex)].event.time??0);render(atOrBefore(clockTimes,time))});document.addEventListener('keydown',event=>{if(event.target?.matches?.('input,select,textarea'))return;if(event.key==='ArrowLeft'){event.preventDefault();q('#previous').click()}else if(event.key==='ArrowRight'){event.preventDefault();q('#next').click()}else if(event.key===' '){event.preventDefault();q('#play').click()}});
const sideContext=(side,time)=>{const frameIndex=sideFrame(side,time),row=rowAt(side,time);return side.run?{runId:side.run.id,resultHash:side.run.manifest?.resultHash,replayId:side.replay?.id??null,replayFrame:frameIndex,mappedFrameTimeSeconds:side.times[frameIndex]??null,simulationStep:row?.step??null,rowTimeSeconds:row?.time??null,healthy:row?.healthy??null,pitchRad:row?.pitchRad??null,bodyTiltRad:row?.bodyTiltRad??null,motionCommand:row?.motionCommand??null,measuredMotion:row?.measuredMotion??null,footContactForce:row?.footContactForce??null,motionQuality:row?.motionQuality??null,action:row?.action??null}:null};
q('#copy-frame').onclick=async()=>{const time=clockTimes[currentClock],deltas=Object.fromEntries(qualityKeys.map(key=>[key,B.run&&A.run?Number(B.run.metrics?.[key]??0)-Number(A.run.metrics?.[key]??0):null])),context={kind:B.run?'mujica-run-comparison-context':'mujica-frame-context',sharedTimeSeconds:time,baseline:sideContext(A,time),subject:sideContext(B,time),motionQualityDeltaSubjectMinusBaseline:deltas};const text=JSON.stringify(context,null,2);try{await navigator.clipboard.writeText(text);q('#copy-status').textContent='Copied exact immutable Run comparison context.'}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();q('#copy-status').textContent='Copied comparison context.'}};
q('#replay-status').textContent=[A.replay&&('A '+A.replay.renderer+' · '+A.replay.frameCount+' exact qpos frames'),B.replay&&('B '+B.replay.renderer+' · '+B.replay.frameCount+' exact qpos frames')].filter(Boolean).join(' · ')||'Generate a Run with mujica studio to add an authoritative MuJoCo replay.';
q('#sampling').textContent=[A.run&&('A trajectory '+A.run.trajectory.total+' rows'),B.run&&('B trajectory '+B.run.trajectory.total+' rows')].filter(Boolean).join(' · ');
render(0);
</script></body></html>`;
}

export async function writeStudioSnapshot(projectDirectory: string, options: { run?: string; replay?: ReplayInput; compareRun?: string; compareReplay?: ReplayInput } = {}) {
  const project = await loadProject(projectDirectory); const snapshot = await buildStudioSnapshot(project.rootDir, options); const snapshotHash = hashJson(snapshot);
  const id = `studio-${snapshotHash.slice(0, 16)}`; const target = join(project.rootDir, ".mujica", "studio", id);
  if (!(await exists(join(target, "snapshot.json")))) await atomicDirectory(target, async (directory) => {
    await writeJson(join(directory, "snapshot.json"), snapshot);
    if (options.replay) await cp(options.replay.path, join(directory, "replay"), { recursive: true });
    if (options.compareReplay) await cp(options.compareReplay.path, join(directory, "comparison-replay"), { recursive: true });
    await Bun.write(join(directory, "index.html"), studioHtml(snapshot));
  });
  return { id, snapshotHash, path: target, indexPath: join(target, "index.html"), selectedRun: snapshot.selectedRun?.id ?? null, comparisonRun: snapshot.comparisonRun?.id ?? null, snapshot };
}
