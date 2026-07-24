import { cp, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicDirectory, hashJson, listWorkspaceProjects, loadDevelopmentCharter, loadWorkspace, sha256, writeJson } from "@mujica/core";
import { writeStudioSnapshot } from "./snapshot";
import { currentDevelopmentReview, currentDevelopmentWorkOrder } from "./snapshot";

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function hasCompletedRun(projectDirectory: string): Promise<boolean> {
  const root = join(projectDirectory, "runs");
  if (!(await exists(root))) return false;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name, "manifest.json");
    if (await exists(path)) {
      const manifest = JSON.parse(await readFile(path, "utf8"));
      if (manifest.completed === true) return true;
    }
  }
  return false;
}

async function existingVisualStudio(projectDirectory: string): Promise<{ id: string; path: string } | null> {
  const root = join(projectDirectory, ".mujica", "studio");
  if (!(await exists(root))) return null;
  const candidates: Array<{ id: string; path: string }> = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith("studio-")) continue;
    const path = join(root, entry.name);
    const snapshotPath = join(path, "snapshot.json");
    if (!(await exists(snapshotPath)) || !(await exists(join(path, "index.html")))) continue;
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    if (
      snapshot.kind === "mujica-studio-snapshot"
      && snapshot.charter
      && (snapshot.selectedReplay || snapshot.researchTimeline || snapshot.selectedHardwareReplay || snapshot.selectedTwinReplay)
    ) candidates.push({ id: entry.name, path });
  }
  const currentPath = join(root, "current.json");
  if (await exists(currentPath)) {
    const current = JSON.parse(await readFile(currentPath, "utf8"));
    if (current.version === 1 && typeof current.id === "string" && /^studio-[a-f0-9]{16}$/.test(current.id)) {
      const selected = candidates.find((candidate) => candidate.id === current.id);
      if (selected) return selected;
    }
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id)).at(-1) ?? null;
}

export async function buildWorkspaceStudioSnapshot(workspaceDirectory: string) {
  const workspace = await loadWorkspace(workspaceDirectory);
  const projects = [];
  for (const project of await listWorkspaceProjects(workspace.rootDir)) {
    const charter = await loadDevelopmentCharter(project.rootDir);
    const developmentReview = await currentDevelopmentReview(project.rootDir);
    const developmentWorkOrder = await currentDevelopmentWorkOrder(project.rootDir, developmentReview);
    const visualStudio = await existingVisualStudio(project.rootDir);
    const generatedStudio = !visualStudio && await hasCompletedRun(project.rootDir) ? await writeStudioSnapshot(project.rootDir) : null;
    const studio = visualStudio ?? (generatedStudio ? { id: generatedStudio.id, path: generatedStudio.path } : null);
    projects.push({
      id: project.manifest.id,
      name: project.manifest.name,
      isDefault: project.isDefault,
      proposition: charter.proposition,
      northStar: charter.northStar,
      morphology: charter.morphology,
      capabilityStages: charter.capabilityStages,
      nonGoals: charter.nonGoals,
      defaults: project.manifest.defaults,
      developmentReview: developmentReview ? {
        id: developmentReview.manifest.id,
        status: developmentReview.review.summary.status,
        designPassed: developmentReview.review.summary.designPassed,
        passedStages: developmentReview.review.summary.passedStages,
        totalStages: developmentReview.review.summary.totalStages,
      } : null,
      developmentWorkOrder: developmentWorkOrder ? {
        id: developmentWorkOrder.manifest.id,
        status: developmentWorkOrder.workOrder.status,
        blockers: developmentWorkOrder.workOrder.blockers.length,
        lanes: developmentWorkOrder.workOrder.lanes.length,
      } : null,
      studio: studio ? { id: studio.id, sourcePath: studio.path, relativeIndex: `projects/${project.manifest.id}/index.html?v=${studio.id}` } : null,
    });
  }
  return {
    version: 1,
    kind: "mujica-workspace-studio-snapshot",
    renderer: { id: "mujica-workspace-studio-offline-v1", sourceHash: sha256(workspaceHtml.toString()) },
    workspace: workspace.manifest,
    workspaceRoot: workspace.rootDir,
    templates: [{
      id: "hexapod",
      name: "Six-legged walking robot",
      description: "Executable MuJoCo morphology, readable tripod Controller, Charter, and starter capability Benchmark.",
    }],
    projects,
  };
}

function workspaceHtml(snapshot: Awaited<ReturnType<typeof buildWorkspaceStudioSnapshot>>): string {
  const data = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
  const title = snapshot.workspace.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'">
<title>Mujica Workspace — ${title}</title>
<style>
:root{color-scheme:dark;--bg:#0a0f14;--panel:#111923;--line:#263544;--text:#eef5f8;--muted:#91a2b2;--accent:#66d8ad;--warm:#edc66c}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}header{padding:22px 26px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:20px}h1,h2,h3,p{margin-top:0}h1{font-size:21px;margin-bottom:5px}h2{font-size:15px;color:var(--accent)}h3{font-size:14px;margin-bottom:7px}.muted{color:var(--muted)}main{display:grid;grid-template-columns:390px minmax(500px,1fr);height:calc(100vh - 88px)}aside{padding:14px;overflow:auto;border-right:1px solid var(--line)}.viewer{min-width:0;background:#070b10}.viewer iframe{border:0;width:100%;height:100%;background:var(--bg)}.empty{padding:60px;max-width:720px}.panel,.card{border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:13px;margin-bottom:12px}.card{cursor:pointer;text-align:left;color:inherit;width:100%;font:inherit}.card:hover,.card.active{border-color:var(--accent)}.tags{display:flex;gap:6px;flex-wrap:wrap}.tag{border:1px solid var(--line);border-radius:999px;padding:2px 7px;color:var(--muted);font-size:12px}.tag.active{color:var(--warm)}label{display:block;color:var(--muted);margin:9px 0 3px}input,select,button{font:inherit}input,select{width:100%;background:#0a1118;color:var(--text);border:1px solid var(--line);padding:8px;border-radius:6px}button.action{margin-top:10px;background:var(--accent);color:#07120e;border:0;border-radius:6px;padding:8px 11px;cursor:pointer}.command{white-space:pre-wrap;word-break:break-word;background:#080d12;border:1px solid var(--line);border-radius:6px;padding:9px;margin-top:9px;color:var(--warm)}@media(max-width:900px){main{display:block;height:auto}aside{border-right:0}.viewer{height:75vh}}
</style></head><body>
<header><div><h1>Mujica Workspace</h1><div>${title} · ${snapshot.projects.length} governed robot project${snapshot.projects.length === 1 ? "" : "s"}</div></div><div class="muted">Workspace owns discovery only<br>Each robot owns its Charter, source, and evidence</div></header>
<main><aside>
  <section class="panel"><h2>Projects</h2><div id="projects"></div></section>
  <section class="panel"><h2>New Project</h2><p class="muted">Prepare the same explicit CLI mutation used by a Coding Agent. Regenerate this snapshot after creation.</p>
    <label for="template">Template</label><select id="template"></select>
    <label for="project-id">Project ID</label><input id="project-id" value="new-hexapod" pattern="[a-z0-9]+(?:-[a-z0-9]+)*">
    <label for="project-name">Display name</label><input id="project-name" value="New Hexapod Development Lab">
    <div class="command" id="create-command"></div><button class="action" id="copy-create">Copy create command</button>
    <div class="muted" id="copy-status"></div>
  </section>
</aside><section class="viewer" id="viewer"><div class="empty"><h2>Select a project</h2><p>The embedded project Studio remains a read-only evidence view. Projects without a completed Run show their exact starter command instead.</p></div></section></main>
<script>
const S=${data},q=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shell=v=>"'" + String(v).replaceAll("'","'\\\\''") + "'";
function projectCard(project){const stages=project.capabilityStages.map(stage=>'<span class="tag '+esc(stage.status)+'">'+esc(stage.id)+' · '+esc(stage.status)+'</span>').join(''),review=project.developmentReview?'<span class="tag '+(project.developmentReview.status==='NORTH_STAR_SATISFIED'?'active':'')+'">'+esc(project.developmentReview.status)+' · '+esc(project.developmentReview.passedStages)+'/'+esc(project.developmentReview.totalStages)+' stages</span>':'<span class="tag">NO REVIEW</span>',work=project.developmentWorkOrder?'<span class="tag">'+esc(project.developmentWorkOrder.status)+' · '+esc(project.developmentWorkOrder.blockers)+' blockers / '+esc(project.developmentWorkOrder.lanes)+' lanes</span>':'<span class="tag">NO WORK ORDER</span>';return '<button class="card" data-project="'+esc(project.id)+'"><h3>'+(project.isDefault?'★ ':'')+esc(project.name)+'</h3><p>'+esc(project.proposition)+'</p><div class="tags"><span class="tag">'+esc(project.morphology.class)+' · '+esc(project.morphology.limbCount)+' limbs</span>'+review+work+stages+'</div></button>'}
q('#projects').innerHTML=S.projects.map(projectCard).join('')||'<p class="muted">No projects yet.</p>';
function openProject(id){const project=S.projects.find(item=>item.id===id);document.querySelectorAll('[data-project]').forEach(node=>node.classList.toggle('active',node.dataset.project===id));if(project.studio){q('#viewer').innerHTML='<iframe title="'+esc(project.name)+' Studio" src="'+esc(project.studio.relativeIndex)+'"></iframe>'}else{const d=project.defaults,argv=['simulate',S.workspaceRoot,'--project',project.id,'--assembly',d.assembly,'--controller',d.controller,'--task',d.task,'--scenario',d.scenario],command='mujica '+argv.map(shell).join(' ');q('#viewer').innerHTML='<div class="empty"><h2>'+esc(project.name)+'</h2><p>'+esc(project.proposition)+'</p><p class="muted">No completed Simulation Run exists yet.</p><div class="command">'+esc(command)+'</div></div>'}}
document.querySelectorAll('[data-project]').forEach(node=>node.onclick=()=>openProject(node.dataset.project));
q('#template').innerHTML=S.templates.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+'</option>').join('');
function createCommand(){const id=q('#project-id').value.trim(),name=q('#project-name').value.trim(),template=q('#template').value,valid=/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)&&name.length>0;const argv=['project','create',S.workspaceRoot,'--id',id,'--name',name,'--template',template],command='mujica '+argv.map(shell).join(' ');q('#create-command').textContent=valid?command:'Use a lowercase kebab-case ID and non-empty name.';q('#copy-create').disabled=!valid;return valid?command:null}
['#project-id','#project-name','#template'].forEach(id=>q(id).oninput=createCommand);createCommand();
q('#copy-create').onclick=async()=>{const command=createCommand();if(!command)return;try{await navigator.clipboard.writeText(command)}catch{const area=document.createElement('textarea');area.value=command;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}q('#copy-status').textContent='Copied. Run it in this Workspace, then regenerate mujica studio.'};
const initial=S.projects.find(item=>item.isDefault&&item.studio)||S.projects.find(item=>item.studio);if(initial)openProject(initial.id);
</script></body></html>`;
}

export async function writeWorkspaceStudioSnapshot(workspaceDirectory: string) {
  const workspace = await loadWorkspace(workspaceDirectory);
  const snapshot = await buildWorkspaceStudioSnapshot(workspace.rootDir);
  const snapshotHash = hashJson(snapshot);
  const id = `workspace-studio-${snapshotHash.slice(0, 16)}`;
  const target = join(workspace.rootDir, ".mujica", "studio", id);
  if (!(await exists(join(target, "snapshot.json")))) await atomicDirectory(target, async (directory) => {
    await writeJson(join(directory, "snapshot.json"), snapshot);
    for (const project of snapshot.projects) if (project.studio) {
      await cp(project.studio.sourcePath, join(directory, "projects", project.id), { recursive: true });
    }
    await Bun.write(join(directory, "index.html"), workspaceHtml(snapshot));
  });
  return { id, path: target, indexPath: join(target, "index.html"), snapshot };
}
