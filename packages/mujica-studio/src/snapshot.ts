import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { atomicDirectory, compileAssembly, hashJson, listAssemblyIds, listComponentIds, loadComponent, loadProject, writeJson } from "@mujica/core";

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function artifactManifests(root: string): Promise<unknown[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: unknown[] = [];
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

export async function buildStudioSnapshot(projectDirectory: string, options: { run?: string } = {}) {
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
  return {
    version: 1, kind: "mujica-studio-snapshot", project: project.manifest,
    selectedAssembly: project.manifest.defaults.assembly, assemblies, components,
    runs: runs.summaries, selectedRun: runs.selected,
    policies: await artifactManifests(join(project.rootDir, "policies")),
    trainingRuns: await artifactManifests(join(project.rootDir, "training-runs")),
    hardwareBundles: await artifactManifests(join(project.rootDir, "hardware-bundles")),
    hardwareVerifications: await artifactManifests(join(project.rootDir, "hardware-verifications")),
    benchmarks: await definitions(join(project.rootDir, "benchmarks"), ".benchmark.json"),
    candidates: await candidateDefinitions(join(project.rootDir, "candidates")),
    revisions: await artifactManifests(join(project.rootDir, "revisions")),
    policyRevisions: await artifactManifests(join(project.rootDir, "policy-revisions")),
  };
}

function studioHtml(snapshot: Awaited<ReturnType<typeof buildStudioSnapshot>>): string {
  const data = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
  const title = snapshot.project.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<title>Mujica Studio — ${title}</title>
<style>
:root{color-scheme:dark;--bg:#0b1015;--panel:#121a22;--line:#263442;--muted:#8ea0af;--text:#edf4f8;--a:#65d6ad;--b:#efc66b;--bad:#ff7b72}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}header{padding:22px 28px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:20px}h1,h2,h3{margin:0 0 10px;font-weight:600}h1{font-size:20px}h2{font-size:15px;color:var(--a)}h3{font-size:13px}.muted{color:var(--muted)}main{display:grid;grid-template-columns:minmax(340px,1.25fr) minmax(300px,.75fr);gap:14px;padding:14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;min-width:0}.wide{grid-column:1/-1}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.stat{border:1px solid var(--line);padding:10px;border-radius:6px}.stat strong{display:block;font-size:18px;color:var(--b)}select,input,button{font:inherit;color:var(--text);background:#0d151c;border:1px solid var(--line);border-radius:5px;padding:6px}button{cursor:pointer}canvas{width:100%;height:360px;background:#090e12;border:1px solid var(--line);border-radius:6px}.controls{display:flex;gap:8px;align-items:center;margin-top:8px}.controls input{flex:1}.split{display:grid;grid-template-columns:1fr 1fr;gap:12px}.list{max-height:340px;overflow:auto}.row{padding:7px 0;border-bottom:1px solid var(--line);word-break:break-word}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:1px 7px;margin:2px;color:var(--muted)}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:5px;border-bottom:1px solid var(--line)}code{color:var(--b)}@media(max-width:850px){main{grid-template-columns:1fr}.split{grid-template-columns:1fr}}
</style></head><body><header><div><h1>Mujica Studio</h1><div>${title} · read-only evidence debugger</div></div><div class="muted">Source of truth: project files and immutable artifacts<br>No editing or evaluation occurs in Studio</div></header>
<main><section class="panel wide"><div class="stats" id="stats"></div></section>
<section class="panel"><h2>Trajectory replay</h2><canvas id="trajectory" width="900" height="420"></canvas><div class="controls"><button id="play">Play</button><input id="scrub" type="range" min="0" value="0"><span id="frame">—</span></div><div class="muted" id="sampling"></div></section>
<section class="panel"><h2>Run evidence</h2><div id="run"></div><h3>Metrics</h3><table id="metrics"></table></section>
<section class="panel"><h2>Assembly and contracts</h2><select id="assembly"></select><div id="assembly-detail"></div></section>
<section class="panel"><h2>Event timeline</h2><div class="list" id="events"></div></section>
<section class="panel wide"><div class="split"><div><h2>Robot Revision lineage</h2><div class="list" id="revisions"></div></div><div><h2>Training and Policy artifacts</h2><div class="list" id="training"></div></div></div></section>
<section class="panel wide"><div class="split"><div><h2>Locked Benchmark definitions</h2><div class="list" id="benchmarks"></div></div><div><h2>Development Candidates</h2><div class="list" id="candidates"></div></div></div></section></main>
<script>const S=${data};const q=s=>document.querySelector(s), esc=v=>String(v??'—').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const selected=S.selectedRun, trajectory=selected?.trajectory.rows??[];q('#stats').innerHTML=[['Assemblies',S.assemblies.length],['Components',S.components.length],['Runs',S.runs.length],['Policies',S.policies.length],['Robot revisions',S.revisions.length],['Hardware evidence',S.hardwareVerifications.length]].map(x=>'<div class="stat"><strong>'+x[1]+'</strong>'+x[0]+'</div>').join('');
q('#run').innerHTML=selected?'<div class="row"><code>'+esc(selected.id)+'</code></div><div class="row">seed '+esc(selected.manifest?.seed)+' · result '+esc(selected.manifest?.resultHash?.slice?.(0,12))+'</div>':'<div class="muted">No completed simulation run.</div>';const metric=selected?.metrics??{};q('#metrics').innerHTML=Object.entries(metric).filter(([,v])=>typeof v==='number'||typeof v==='string'||typeof v==='boolean').map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+esc(typeof v==='number'?Number(v).toFixed(4):v)+'</td></tr>').join('');
const sel=q('#assembly');sel.innerHTML=S.assemblies.map(a=>'<option '+(a.id===S.selectedAssembly?'selected':'')+' value="'+esc(a.id)+'">'+esc(a.id)+'</option>').join('');function showAssembly(){const a=S.assemblies.find(x=>x.id===sel.value);q('#assembly-detail').innerHTML='<div class="row">hash <code>'+esc(a.hash.slice(0,16))+'</code><br>mass '+a.totalMassKg.toFixed(3)+' kg · component cost '+a.componentCost+'</div><h3>Components</h3><div>'+a.components.map(c=>'<div class="row"><span class="tag">'+esc(c.componentId)+'</span> <code>'+esc(JSON.stringify(c.config||{}))+'</code></div>').join('')+'</div><h3>Observation '+a.observationContract.size+'</h3><div>'+a.observationContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div><h3>Action '+a.actionContract.size+'</h3><div>'+a.actionContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div>'}sel.onchange=showAssembly;showAssembly();
q('#events').innerHTML=(selected?.events.rows??[]).map(e=>'<div class="row"><code>'+Number(e.time??0).toFixed(3)+'s</code> '+esc(e.type)+'<div class="muted">'+esc(JSON.stringify(e))+'</div></div>').join('')||'<div class="muted">No events.</div>';q('#revisions').innerHTML=S.revisions.map(r=>'<div class="row"><code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.parent??'root')+' → score '+esc(Number(r.aggregateScore).toFixed(4))+'</span></div>').join('');q('#training').innerHTML=S.policyRevisions.map(r=>'<div class="row">Policy revision <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('')+S.trainingRuns.slice(-8).map(r=>'<div class="row">Training <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('');
q('#benchmarks').innerHTML=S.benchmarks.map(b=>'<div class="row"><code>'+esc(b.id)+'</code><br><span class="muted">'+esc(b.objective)+' · '+b.cases.length+' fixed cases · baseline '+esc(b.baseline.assembly)+'/'+esc(b.baseline.controller)+'</span></div>').join('');q('#candidates').innerHTML=S.candidates.map(c=>'<div class="row"><code>'+esc(c.id)+'</code> <span class="tag">'+esc(c.kind)+'</span><br><span class="muted">'+esc(c.baseline.assembly)+'/'+esc(c.baseline.controller)+' → '+esc(c.proposed.assembly)+'/'+esc(c.proposed.controller)+'</span></div>').join('');
const canvas=q('#trajectory'),ctx=canvas.getContext('2d'),scrub=q('#scrub'),frame=q('#frame');scrub.max=Math.max(0,trajectory.length-1);let timer=null;function draw(i){ctx.clearRect(0,0,canvas.width,canvas.height);if(!trajectory.length){ctx.fillStyle='#8ea0af';ctx.fillText('No trajectory selected',30,40);return}const pts=trajectory.map(r=>[r.qpos?.[0]??0,r.qpos?.[1]??0]);let xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),span=Math.max(maxX-minX,maxY-minY,.25),map=p=>[60+(p[0]-minX)/span*(canvas.width-120),canvas.height-60-(p[1]-minY)/span*(canvas.height-120)];ctx.strokeStyle='#263442';ctx.lineWidth=1;for(let n=0;n<9;n++){let p=60+n*(canvas.width-120)/8;ctx.beginPath();ctx.moveTo(p,40);ctx.lineTo(p,canvas.height-40);ctx.stroke()}ctx.strokeStyle='#65d6ad';ctx.lineWidth=3;ctx.beginPath();pts.slice(0,i+1).forEach((p,n)=>{let m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();let m=map(pts[i]);ctx.fillStyle=trajectory[i].healthy===false?'#ff7b72':'#efc66b';ctx.beginPath();ctx.arc(...m,8,0,Math.PI*2);ctx.fill();frame.textContent='step '+trajectory[i].step+' · '+Number(trajectory[i].time).toFixed(2)+'s';scrub.value=i}scrub.oninput=()=>draw(Number(scrub.value));q('#play').onclick=()=>{if(timer){clearInterval(timer);timer=null;q('#play').textContent='Play';return}q('#play').textContent='Pause';timer=setInterval(()=>{let n=Number(scrub.value)+1;if(n>=trajectory.length){clearInterval(timer);timer=null;q('#play').textContent='Play';return}draw(n)},40)};q('#sampling').textContent=selected?'trajectory '+selected.trajectory.total+' rows · displayed '+trajectory.length+' · stride '+selected.trajectory.stride:'';draw(0);
</script></body></html>`;
}

export async function writeStudioSnapshot(projectDirectory: string, options: { run?: string } = {}) {
  const project = await loadProject(projectDirectory); const snapshot = await buildStudioSnapshot(project.rootDir, options); const snapshotHash = hashJson(snapshot);
  const id = `studio-${snapshotHash.slice(0, 16)}`; const target = join(project.rootDir, ".mujica", "studio", id);
  if (!(await exists(join(target, "snapshot.json")))) await atomicDirectory(target, async (directory) => {
    await writeJson(join(directory, "snapshot.json"), snapshot);
    await Bun.write(join(directory, "index.html"), studioHtml(snapshot));
  });
  return { id, snapshotHash, path: target, indexPath: join(target, "index.html"), selectedRun: snapshot.selectedRun?.id ?? null, snapshot };
}
