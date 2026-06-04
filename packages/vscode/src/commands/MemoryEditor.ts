import * as vscode from 'vscode';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '@agentx/shared';
import type { SecretSauceManager } from '@agentx/engine';
import type { MemoryEntry } from '../providers/MemoryTreeProvider';

export class MemoryEditor {
  private panel: vscode.WebviewPanel | null = null;
  private secretSauce: SecretSauceManager | null = null;
  private disposables: vscode.Disposable[] = [];

  setSecretSauce(sauce: SecretSauceManager): void {
    this.secretSauce = sauce;
  }

  async show(context: vscode.ExtensionContext): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postMessage();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'agentxMemoryEditor',
      'Agent-X Memories',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    }, null, this.disposables);

    this.postMessage();
  }

  private postMessage(): void {
    if (!this.panel || !this.secretSauce) return;

    const globalMemories = this.secretSauce.memories.getGlobalMemories(100);
    const crewMemories = this.secretSauce.memories.getCrewMemories(100);
    const activeCrew = this.secretSauce.crew.getActive()!;

    this.panel.webview.postMessage({
      type: 'memories-loaded',
      globalMemories,
      crewMemories,
      crewName: activeCrew.name,
      crewId: activeCrew.id,
    });
  }

  private async handleMessage(msg: { command: string; payload?: unknown }): Promise<void> {
    if (!this.secretSauce) return;

    switch (msg.command) {
      case 'add-memory': {
        const { content, category } = msg.payload as { content: string; category: string };
        this.secretSauce.recordMemory(content, category);
        this.postMessage();
        vscode.commands.executeCommand('agentx.memory.refresh');
        break;
      }

      case 'delete-memory': {
        const payload = msg.payload as { id: string; scope: 'global' | 'crew' };
        const confirmed = await vscode.window.showWarningMessage(
          'Delete this memory? This cannot be undone.',
          { modal: true },
          'Delete',
        );
        if (confirmed === 'Delete') {
          this.deleteMemoryFromFile(payload.id, payload.scope);
          this.postMessage();
          vscode.commands.executeCommand('agentx.memory.refresh');
        }
        break;
      }

      case 'search': {
        const query = msg.payload as string;
        const results = this.secretSauce.memories.searchMemories(query);
        this.panel?.webview.postMessage({
          type: 'search-results',
          results,
        });
        break;
      }

      case 'export': {
        await this.exportMemories();
        break;
      }

      case 'refresh': {
        this.postMessage();
        break;
      }
    }
  }

  private deleteMemoryFromFile(memoryId: string, scope: 'global' | 'crew'): void {
    const sauceDir = getSecretSauceDir();
    let filePath: string;

    if (scope === 'global') {
      filePath = join(sauceDir, 'global', 'memories.json');
    } else {
      const crewId = this.secretSauce!.crew.getActiveId()!;
      filePath = join(sauceDir, 'crews', crewId, 'memories.json');
    }

    if (!existsSync(filePath)) return;

    try {
      const entries = JSON.parse(readFileSync(filePath, 'utf-8')) as MemoryEntry[];
      const filtered = entries.filter((e) => e.id !== memoryId);
      writeFileSync(filePath, JSON.stringify(filtered, null, 2));
    } catch {
      vscode.window.showErrorMessage('Failed to delete memory from file.');
    }
  }

  private async exportMemories(): Promise<void> {
    if (!this.secretSauce) return;

    const globalMemories = this.secretSauce.memories.getGlobalMemories(100);
    const crewMemories = this.secretSauce.memories.getCrewMemories(100);

    const exportData = {
      exportedAt: new Date().toISOString(),
      crewName: this.secretSauce.crew.getActive()!.name,
      global: globalMemories,
      crew: crewMemories,
      total: globalMemories.length + crewMemories.length,
    };

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`agentx-memories-${Date.now()}.json`),
      filters: { 'JSON Files': ['json'] },
    });

    if (uri) {
      writeFileSync(uri.fsPath, JSON.stringify(exportData, null, 2));
      vscode.window.showInformationMessage(`Memories exported to ${uri.fsPath}`);
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent-X Memories</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);padding:16px}
.toolbar{display:flex;gap:8px;margin-bottom:16px;align-items:center}
.toolbar input{flex:1;padding:6px 10px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;font-size:13px}
.toolbar button{padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px}
.toolbar button:hover{background:var(--vscode-button-hoverBackground)}
.section{margin-bottom:24px}
.section-header{background:var(--vscode-sideBarSectionHeader-background);padding:8px 12px;border-radius:4px 4px 0 0;font-weight:600;font-size:14px;display:flex;justify-content:space-between}
.memory-list{border:1px solid var(--vscode-panel-border);border-top:none;border-radius:0 0 4px 4px}
.memory-item{padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border);display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.memory-item:last-child{border-bottom:none}
.memory-content{flex:1}
.memory-text{font-size:13px;line-height:1.4;margin-bottom:4px}
.memory-meta{font-size:11px;opacity:0.7;display:flex;gap:8px}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:10px}
.delete-btn{background:none;border:none;color:var(--vscode-errorForeground);cursor:pointer;font-size:16px;padding:2px 6px;opacity:0.6}
.delete-btn:hover{opacity:1}
.empty{padding:20px;text-align:center;opacity:0.5;font-style:italic}
.add-form{padding:12px;border:1px solid var(--vscode-panel-border);border-radius:4px;margin-bottom:16px}
.add-form h3{margin-bottom:8px;font-size:13px}
.add-form textarea{width:100%;padding:8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;font-family:inherit;font-size:13px;resize:vertical;min-height:60px}
.add-form select{padding:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;margin-right:8px}
.add-form .form-actions{margin-top:8px;display:flex;gap:8px}
.hidden{display:none}
</style>
</head>
<body>
<div class="toolbar">
<input type="text" id="searchInput" placeholder="Search memories...">
<button onclick="doSearch()">Search</button>
<button onclick="toggleAddForm()">+ Add</button>
<button onclick="doExport()">Export</button>
</div>
<div id="addForm" class="add-form hidden">
<h3>Add Memory</h3>
<textarea id="newMemoryContent" placeholder="Enter memory content..."></textarea>
<div class="form-actions">
<select id="newMemoryCategory">
<option value="identity">Identity</option>
<option value="preference">Preference</option>
<option value="project">Project</option>
<option value="instruction">Instruction</option>
<option value="context">Context</option>
</select>
<button onclick="addMemory()">Save</button>
<button onclick="toggleAddForm()">Cancel</button>
</div>
</div>
<div id="searchResults" class="section hidden">
<div class="section-header"><span>Search Results</span><button onclick="clearSearch()" style="background:none;border:none;color:var(--vscode-editor-foreground);cursor:pointer;">✕</button></div>
<div class="memory-list" id="searchResultsList"></div>
</div>
<div id="globalSection" class="section">
<div class="section-header"><span>Global Memories</span><span id="globalCount">0</span></div>
<div class="memory-list" id="globalList"></div>
</div>
<div id="crewSection" class="section">
<div class="section-header"><span id="crewHeader">Crew Memories</span><span id="crewCount">0</span></div>
<div class="memory-list" id="crewList"></div>
</div>
<script>
const vscode=acquireVsCodeApi();
function renderMemory(mem,scope){
const d=new Date(mem.timestamp);
return '<div class="memory-item"><div class="memory-content"><div class="memory-text">'+esc(mem.content)+'</div><div class="memory-meta"><span class="badge">'+esc(mem.category)+'</span><span>'+d.toLocaleDateString()+'</span></div></div><button class="delete-btn" onclick="deleteMem('+mem.id+','+scope+')">🗑</button></div>'
}
function renderList(id,mems,scope){
const e=document.getElementById(id);
if(!mems.length)e.innerHTML='<div class="empty">No memories</div>';
else e.innerHTML=mems.map(m=>renderMemory(m,scope)).join('')
}
function esc(t){return document.createElement('div').appendChild(document.createTextNode(t)).parentNode.innerHTML}
function doSearch(){const q=document.getElementById('searchInput').value.trim();if(q)vscode.postMessage({command:'search',payload:q})}
function clearSearch(){document.getElementById('searchInput').value='';document.getElementById('searchResults').classList.add('hidden')}
function toggleAddForm(){document.getElementById('addForm').classList.toggle('hidden')}
function addMemory(){const c=document.getElementById('newMemoryContent').value.trim();const cat=document.getElementById('newMemoryCategory').value;if(!c)return;vscode.postMessage({command:'add-memory',payload:{content:c,category:cat}});document.getElementById('newMemoryContent').value='';toggleAddForm()}
function deleteMem(id,scope){vscode.postMessage({command:'delete-memory',payload:{id,scope}})}
function doExport(){vscode.postMessage({command:'export'})}
document.getElementById('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch()});
window.addEventListener('message',e=>{const m=e.data;switch(m.type){case'memories-loaded':renderList('globalList',m.globalMemories,'global');renderList('crewList',m.crewMemories,'crew');document.getElementById('globalCount').textContent=m.globalMemories.length;document.getElementById('crewCount').textContent=m.crewMemories.length;document.getElementById('crewHeader').textContent=m.crewName+' Memories';break;case'search-results':const l=document.getElementById('searchResultsList');if(!m.results.length)l.innerHTML='<div class="empty">No results</div>';else l.innerHTML=m.results.map(r=>renderMemory(r,'global')).join('');document.getElementById('searchResults').classList.remove('hidden');break}});
</script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
